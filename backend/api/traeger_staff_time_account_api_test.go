// Router-level test for the Stundenkonto of the Personalakte (#4711, ADR
// 0240): the Personalverwaltung reads Soll and Ist of a person over all
// schools, closes the month in every school its contract covers and reopens
// it. The school leaves the person out of its own close and cannot reopen
// the Träger's; no role without the right and no other Träger reaches the
// account, and every read is in the access log of each school.
package api

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"

	"github.com/moto-ogs/project-phoenix/modules/identityaccess"
	"github.com/moto-ogs/project-phoenix/modules/workforce"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/tenant"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	querybudgets "github.com/moto-ogs/project-phoenix/test/query-budgets"
)

type timeAccountBody struct {
	State                 string `json:"state"`
	Ended                 bool   `json:"ended"`
	TargetMinutes         int    `json:"target_minutes"`
	ActualMinutes         int    `json:"actual_minutes"`
	BalanceMinutes        int    `json:"balance_minutes"`
	ClosingBalanceMinutes int    `json:"closing_balance_minutes"`
	Schools               []struct {
		SchoolID        int64  `json:"school_id"`
		SchoolName      string `json:"school_name"`
		TargetMinutes   int    `json:"target_minutes"`
		ActualMinutes   int    `json:"actual_minutes"`
		BalanceMinutes  int    `json:"balance_minutes"`
		ByTraeger       bool   `json:"by_traeger"`
		Closed          bool   `json:"closed"`
		ClosedByTraeger bool   `json:"closed_by_traeger"`
		CloseReason     string `json:"close_reason"`
	} `json:"schools"`
}

func TestTraegerStaffTimeAccountSumsAndClosesEverySchool(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	today := time.Date(2026, time.November, 18, 12, 0, 0, 0, calendar.Berlin)
	router, portal, _, unit, office := newTraegerStaffFixtureAt(t, db, func() time.Time { return today })
	north, south := office.schools[0], office.schools[1]
	staffRelease(t, db, office.organization)
	ctx := context.Background()

	miraNorth, account := testpkg.CreateTestStaffWithAccountForTenant(t, db, north, "Mira", "Sommer")
	miraSouth := testpkg.CreateTestStaffForExistingAccountInTenant(t, db, south, account.ID, "Mira", "Sommer")
	colleague := testpkg.CreateTestStaffForTenant(t, db, north, "Jonas", "Keller")
	// October as both schools count it: 5 h Monday to Thursday in the north,
	// 4 h on Fridays in the south, and one worked morning in each school.
	for _, school := range []struct{ id, staff, minutes, from, to int64 }{
		{north, miraNorth.ID, 300, 0, 3}, {south, miraSouth.ID, 240, 4, 4}, {north, colleague.ID, 480, 0, 4},
	} {
		_, err := db.ExecContext(ctx, `INSERT INTO config.staff_work_schedules (tenant_id, staff_id, week_index, rotation_length, day_of_week, target_minutes, valid_from)
			SELECT ?, ?, 0, 1, day, ?, DATE '2026-09-01' FROM generate_series(?::int, ?::int) AS day`, school.id, school.staff, school.minutes, school.from, school.to)
		require.NoError(t, err)
	}
	for _, session := range []struct{ school, staff int64 }{{north, miraNorth.ID}, {south, miraSouth.ID}} {
		_, err := db.ExecContext(ctx, `INSERT INTO active.work_sessions (tenant_id, staff_id, date, check_in_time, check_out_time, created_by)
			VALUES (?, ?, '2026-10-05', '2026-10-05T06:00:00Z', '2026-10-05T10:00:00Z', ?)`, session.school, session.staff, session.staff)
		require.NoError(t, err)
	}

	rec := traegerJSON(t, router, office.token, http.MethodPost, "/traeger/staff-records/", map[string]any{
		"members": []map[string]int64{{"school_id": north, "staff_id": miraNorth.ID}, {"school_id": south, "staff_id": miraSouth.ID}},
	})
	require.Equal(t, http.StatusCreated, rec.Code, rec.Body.String())
	recordID := decode[staffRecordBody](t, rec).ID
	path := fmt.Sprintf("/traeger/staff-records/%d/time-account", recordID)
	october := path + "?year=2026&month=10"

	t.Run("without a contract the schools close the month themselves", func(t *testing.T) {
		rec := traegerJSON(t, router, office.token, http.MethodGet, october, nil)
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		body := decode[timeAccountBody](t, rec)
		assert.Equal(t, workforce.TraegerMonthSchool, body.State)
		rec = traegerJSON(t, router, office.token, http.MethodPost, path+"/close", map[string]any{"year": 2026, "month": 10, "reason": "Abrechnung"})
		assertStaffRefusal(t, rec, http.StatusConflict, "workforce.traeger_month_not_kept")
	})

	rec = traegerJSON(t, router, office.token, http.MethodPost, fmt.Sprintf("/traeger/staff-records/%d/contracts", recordID), map[string]any{
		"kind": "part_time", "starts_on": "2026-08-01",
		"sites": []map[string]any{
			{"school_id": north, "staff_id": miraNorth.ID, "weekday_minutes": []int{300, 300, 300, 300, 0}},
			{"school_id": south, "staff_id": miraSouth.ID, "weekday_minutes": []int{0, 0, 0, 0, 240}},
		},
	})
	require.Equal(t, http.StatusCreated, rec.Code, rec.Body.String())

	t.Run("the account sums Soll and Ist over all schools", func(t *testing.T) {
		rec := traegerJSON(t, router, office.token, http.MethodGet, october, nil)
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		body := decode[timeAccountBody](t, rec)
		assert.Equal(t, workforce.TraegerMonthOpen, body.State)
		assert.True(t, body.Ended)
		require.Len(t, body.Schools, 2)
		// October 2026: 17 Monday-to-Thursdays and 5 Fridays, no holiday.
		assert.Equal(t, 17*300, body.Schools[0].TargetMinutes, body.Schools[0].SchoolName)
		assert.Equal(t, 5*240, body.Schools[1].TargetMinutes, body.Schools[1].SchoolName)
		assert.Equal(t, 17*300+5*240, body.TargetMinutes)
		assert.Equal(t, 480, body.ActualMinutes)
		assert.Equal(t, body.Schools[0].BalanceMinutes+body.Schools[1].BalanceMinutes, body.BalanceMinutes)
		for _, school := range body.Schools {
			assert.True(t, school.ByTraeger, school.SchoolName)
			assert.False(t, school.Closed, school.SchoolName)
		}
	})

	months := newSchoolMonths(t, db, unit)

	t.Run("the reads stay flat in their query budgets", func(t *testing.T) {
		counter := testpkg.CaptureQueriesForContext(t, db)
		req := httptest.NewRequest(http.MethodGet, october, nil)
		req.Header.Set("Authorization", "Bearer "+office.token)
		rec := httptest.NewRecorder()
		testpkg.MeasuredHTTPRequest(counter, router, rec, req.WithContext(counter.Context(req.Context())))
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		querybudgets.AssertQueryBudget(t, "api.traeger.staff_time_account", counter.Measurement(counter.Selects("")))

		school := testpkg.CaptureQueriesForContext(t, db)
		months.within(t, north, func(ctx context.Context) {
			_, err := months.closing.TraegerMonthStaff(school.Context(ctx), 2026, 10)
			require.NoError(t, err)
		})
		querybudgets.AssertQueryBudget(t, "workforce.traeger_month_staff", school.Measurement(school.Queries()))
	})

	t.Run("the school leaves the person out of its close", func(t *testing.T) {
		var result *workforce.MonthCloseResult
		months.within(t, north, func(ctx context.Context) {
			var err error
			result, err = months.closing.CloseMonth(ctx, colleague.ID, 2026, 10, "Abrechnung der Schule")
			require.NoError(t, err)
		})
		assert.Equal(t, 1, result.ClosedStaff, "the colleague without a contract")
		months.within(t, north, func(ctx context.Context) {
			staff, err := months.closing.TraegerMonthStaff(ctx, 2026, 10)
			require.NoError(t, err)
			assert.Equal(t, []int64{miraNorth.ID}, staff)
		})
	})

	t.Run("the month is closed only once it is over and with a reason", func(t *testing.T) {
		rec := traegerJSON(t, router, office.token, http.MethodPost, path+"/close", map[string]any{"year": 2026, "month": 11, "reason": "Abrechnung"})
		assertStaffRefusal(t, rec, http.StatusBadRequest, "workforce.month_not_closable")
		rec = traegerJSON(t, router, office.token, http.MethodPost, path+"/close", map[string]any{"year": 2026, "month": 10, "reason": " "})
		assert.Equal(t, http.StatusBadRequest, rec.Code, rec.Body.String())
	})

	t.Run("the Träger closes the month in every school", func(t *testing.T) {
		rec := traegerJSON(t, router, office.token, http.MethodPost, path+"/close", map[string]any{"year": 2026, "month": 10, "reason": "Abrechnung Oktober"})
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		body := decode[timeAccountBody](t, rec)
		assert.Equal(t, workforce.TraegerMonthClosed, body.State)
		for _, school := range body.Schools {
			assert.True(t, school.ClosedByTraeger, school.SchoolName)
			assert.Equal(t, "Abrechnung Oktober", school.CloseReason)
		}
		assert.Equal(t, 2, staffSchoolValue(t, db, `SELECT COUNT(*) FROM active.staff_month_balance_snapshots
			WHERE source = 'traeger' AND closed_by IS NULL AND closed_by_account_id IS NOT NULL AND year = 2026 AND month = 10 AND reopened_at IS NULL`))
		// A second click changes nothing.
		rec = traegerJSON(t, router, office.token, http.MethodPost, path+"/close", map[string]any{"year": 2026, "month": 10, "reason": "noch einmal"})
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		assert.Equal(t, 2, staffSchoolValue(t, db, `SELECT COUNT(*) FROM active.staff_month_balance_snapshots WHERE source = 'traeger'`))
	})

	t.Run("the closed month locks the school's bookings", func(t *testing.T) {
		months.within(t, north, func(ctx context.Context) {
			_, err := months.ledger.CreateOpeningBalance(ctx, miraNorth.ID, colleague.ID, "2026-10-15", 60, "Übertrag")
			assert.ErrorContains(t, err, "lies in the closed month 2026-10")
		})
	})

	t.Run("only the Träger reopens its close", func(t *testing.T) {
		months.within(t, north, func(ctx context.Context) {
			err := months.closing.ReopenMonth(ctx, miraNorth.ID, colleague.ID, 2026, 10, "Korrektur")
			assert.ErrorIs(t, err, workforce.ErrMonthClosedByTraeger)
		})
		rec := traegerJSON(t, router, office.token, http.MethodPost, path+"/reopen", map[string]any{"year": 2026, "month": 10, "reason": "Korrektur Nord"})
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		body := decode[timeAccountBody](t, rec)
		assert.Equal(t, workforce.TraegerMonthOpen, body.State)
		assert.Equal(t, 2, staffSchoolValue(t, db, `SELECT COUNT(*) FROM active.staff_month_balance_snapshots
			WHERE source = 'traeger' AND reopened_by IS NULL AND reopened_by_account_id IS NOT NULL AND reopen_reason = 'Korrektur Nord'`))
		// The colleague's close stays the school's.
		rec = traegerJSON(t, router, office.token, http.MethodPost, path+"/reopen", map[string]any{"year": 2026, "month": 10, "reason": "noch einmal"})
		assertStaffRefusal(t, rec, http.StatusNotFound, "workforce.month_not_closed")
	})

	t.Run("no role without the right and no other Träger reaches the account", func(t *testing.T) {
		readOnly := newTraegerOffice(t, db, portal, "Träger Lesen", identityaccess.TraegerRoleReadOnly)
		assert.Equal(t, http.StatusForbidden, traegerJSON(t, router, readOnly.token, http.MethodGet, october, nil).Code)
		assert.Equal(t, http.StatusForbidden, traegerJSON(t, router, readOnly.token, http.MethodPost, path+"/close",
			map[string]any{"year": 2026, "month": 10, "reason": "x"}).Code)
		other := newTraegerOffice(t, db, portal, "Träger Anders", identityaccess.TraegerRolePersonnel)
		staffRelease(t, db, other.organization)
		assertStaffRefusal(t, traegerJSON(t, router, other.token, http.MethodGet, october, nil), http.StatusNotFound, "workforce.traeger_staff_record_not_found")
		assertStaffRefusal(t, traegerJSON(t, router, other.token, http.MethodPost, path+"/close",
			map[string]any{"year": 2026, "month": 10, "reason": "x"}), http.StatusNotFound, "workforce.traeger_staff_record_not_found")
	})

	t.Run("every read is in the access log of each school", func(t *testing.T) {
		var views []struct {
			TenantID int64 `bun:"tenant_id"`
		}
		require.NoError(t, db.NewRaw(`SELECT tenant_id FROM audit.data_access_log WHERE actor_role = 'traeger'
			AND metadata->>'view' = ? AND metadata->>'staff_record_id' = ?`, workforce.TraegerStaffViewTimeAccount, fmt.Sprint(recordID)).Scan(ctx, &views))
		seen := map[int64]bool{}
		for _, view := range views {
			seen[view.TenantID] = true
		}
		assert.True(t, seen[north])
		assert.True(t, seen[south])
	})
}

// schoolMonths is the time tracking of the schools, as their own routes use
// it, in a school's tenant transaction.
type schoolMonths struct {
	closing workforce.MonthClosing
	ledger  workforce.BalanceAdjustments
	within  func(t *testing.T, schoolID int64, fn func(context.Context))
}

func newSchoolMonths(t *testing.T, db *bun.DB, unit tenant.UnitOfWork) schoolMonths {
	t.Helper()
	module, _, err := NewWorkforceTestModule(testpkg.NewDatabase(t, db), unit)
	require.NoError(t, err)
	within := func(t *testing.T, schoolID int64, fn func(context.Context)) {
		t.Helper()
		school, err := tenant.NewTenantID(schoolID)
		require.NoError(t, err)
		require.NoError(t, tenant.WithinTenant(staffInSchool(t, unit, schoolID), school, func(ctx context.Context) error {
			fn(ctx)
			return nil
		}))
	}
	return schoolMonths{closing: module.TimeTracking.MonthClosing, ledger: module.TimeTracking.BalanceAdjustments, within: within}
}
