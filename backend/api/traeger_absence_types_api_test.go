// Router-level tests for the Abwesenheitsarten and Kontingente of a Träger
// (#4710, ADR 0089 section 10 with its addendum, ADR 0236): the
// Personalverwaltung creates a type, Workforce carries it into every school
// and takes over a school's own type of the same name, a booking at one
// school draws on the one Kontingent of the person over all schools, a
// school deviates only for its own Einsätze, a role without the right gets
// 403, no Träger reaches another Träger's types, and the accounts of a
// person are in the access log of each Einsatzort.
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

type traegerAbsenceTypeBody struct {
	ID           int64   `json:"id"`
	Name         string  `json:"name"`
	StandardDays float64 `json:"standard_days"`
	Requestable  bool    `json:"requestable"`
	Schools      []struct {
		SchoolID        int64    `json:"school_id"`
		Carried         bool     `json:"carried"`
		Offered         bool     `json:"offered"`
		SchoolLimitDays *float64 `json:"school_limit_days"`
	} `json:"schools"`
}

type traegerAbsenceAccountsBody struct {
	Year     int `json:"year"`
	Accounts []struct {
		AbsenceTypeID int64   `json:"absence_type_id"`
		EntitledDays  float64 `json:"entitled_days"`
		Individual    bool    `json:"individual"`
		TakenDays     float64 `json:"taken_days"`
		ReservedDays  float64 `json:"reserved_days"`
		RemainingDays float64 `json:"remaining_days"`
		Schools       []struct {
			SchoolID     int64    `json:"school_id"`
			TakenDays    float64  `json:"taken_days"`
			ReservedDays float64  `json:"reserved_days"`
			LimitDays    *float64 `json:"limit_days"`
		} `json:"schools"`
	} `json:"accounts"`
}

// schoolTypeOf returns the school's row that carries the Träger's type.
func schoolTypeOf(t *testing.T, db *bun.DB, schoolID, traegerTypeID int64) int64 {
	t.Helper()
	return int64(staffSchoolValue(t, db, `SELECT id FROM active.staff_absence_types WHERE tenant_id = ? AND traeger_absence_type_id = ?`, schoolID, traegerTypeID))
}

// bookAbsence stores one absence of the school as its Leitung's booking
// would, with status.
func bookAbsence(t *testing.T, db *bun.DB, schoolID, staffID, typeID int64, from, to, status string) {
	t.Helper()
	_, err := db.ExecContext(context.Background(), `INSERT INTO active.staff_absences
		(tenant_id, staff_id, absence_type, absence_type_id, date_start, date_end, status, created_by)
		VALUES (?, ?, 'other', ?, ?::date, ?::date, ?, ?)`, schoolID, staffID, typeID, from, to, status, staffID)
	require.NoError(t, err)
}

// inSchool runs fn in the tenant transaction of schoolID.
func inSchool(t *testing.T, unit tenant.UnitOfWork, schoolID int64, fn func(context.Context) error) error {
	t.Helper()
	school, err := tenant.NewTenantID(schoolID)
	require.NoError(t, err)
	return tenant.WithinTenant(staffInSchool(t, unit, schoolID), school, fn)
}

// TestTraegerAbsenceTypesShareOneKontingentOverAllSchools walks the
// acceptance of #4710 end to end.
func TestTraegerAbsenceTypesShareOneKontingentOverAllSchools(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	// The Kontingent of 2027 is read from a day before that year: a year
	// that is over keeps no remaining days.
	now := func() time.Time { return time.Date(2026, time.November, 18, 12, 0, 0, 0, calendar.Berlin) }
	router, portal, _, unit, office := newTraegerStaffFixtureAt(t, db, now)
	module, _, err := NewAbsenceTypeTestModule(testpkg.NewDatabase(t, db), now)
	require.NoError(t, err)
	school := module.Administration
	north, south := office.schools[0], office.schools[1]

	miraNorth, account := testpkg.CreateTestStaffWithAccountForTenant(t, db, north, "Mira", "Sommer")
	miraSouth := testpkg.CreateTestStaffForExistingAccountInTenant(t, db, south, account.ID, "Mira", "Sommer")
	// The north school already has its own Regenerationstag with a booking.
	var ownNorth int64
	require.NoError(t, db.NewRaw(`INSERT INTO active.staff_absence_types (tenant_id, name, base_type, is_active, allowance_enabled)
		VALUES (?, 'Regenerationstag', 'other', true, true) RETURNING id`, north).Scan(context.Background(), &ownNorth))

	t.Run("without the release there is no type of the Träger", func(t *testing.T) {
		rec := traegerJSON(t, router, office.token, http.MethodPost, "/traeger/absence-types/", map[string]any{"name": "Regenerationstag"})
		assertStaffRefusal(t, rec, http.StatusConflict, "workforce.traeger_staff_not_released")
	})

	staffRelease(t, db, office.organization)
	rec := traegerJSON(t, router, office.token, http.MethodPost, "/traeger/staff-records/", map[string]any{
		"members": []map[string]int64{{"school_id": north, "staff_id": miraNorth.ID}, {"school_id": south, "staff_id": miraSouth.ID}},
	})
	require.Equal(t, http.StatusCreated, rec.Code, rec.Body.String())
	record := decode[staffRecordBody](t, rec)

	var regeneration traegerAbsenceTypeBody
	t.Run("a new type goes into every school and takes over the school's own type of that name", func(t *testing.T) {
		rec := traegerJSON(t, router, office.token, http.MethodPost, "/traeger/absence-types/", map[string]any{"name": "Urlaub"})
		assertStaffRefusal(t, rec, http.StatusBadRequest, "workforce.traeger_absence_type_invalid")
		rec = traegerJSON(t, router, office.token, http.MethodPost, "/traeger/absence-types/", map[string]any{
			"name": "Regenerationstag", "allowance_enabled": true, "standard_days": 2, "requestable": true,
		})
		require.Equal(t, http.StatusCreated, rec.Code, rec.Body.String())
		regeneration = decode[traegerAbsenceTypeBody](t, rec)
		require.Len(t, regeneration.Schools, 2)
		for _, carried := range regeneration.Schools {
			assert.True(t, carried.Carried && carried.Offered, "school %d carries the type", carried.SchoolID)
		}
		assert.Equal(t, ownNorth, schoolTypeOf(t, db, north, regeneration.ID), "the school's own type of the same name is taken over")
		assert.NotZero(t, schoolTypeOf(t, db, south, regeneration.ID))
		rec = traegerJSON(t, router, office.token, http.MethodPost, "/traeger/absence-types/", map[string]any{"name": "regenerationstag"})
		assertStaffRefusal(t, rec, http.StatusConflict, "workforce.traeger_absence_type_name_taken")
	})
	northType, southType := schoolTypeOf(t, db, north, regeneration.ID), schoolTypeOf(t, db, south, regeneration.ID)

	t.Run("a booking at one school draws on the one Kontingent of the person", func(t *testing.T) {
		bookAbsence(t, db, north, miraNorth.ID, northType, "2027-03-03", "2027-03-03", "approved")
		require.NoError(t, inSchool(t, unit, south, func(ctx context.Context) error {
			_, err := school.PreviewAllowanceBooking(ctx, miraSouth.ID, southType, "2027-04-05", "2027-04-06", false)
			assert.ErrorIs(t, err, workforce.ErrAbsenceTypeAllowanceExceeded, "one day is left of two after the north school's booking")
			previews, err := school.PreviewAllowanceBooking(ctx, miraSouth.ID, southType, "2027-04-05", "2027-04-05", false)
			require.NoError(t, err)
			require.Len(t, previews, 1)
			assert.Equal(t, 2.0, previews[0].EntitledDays)
			assert.Equal(t, 1.0, previews[0].BookingDays)
			assert.Equal(t, 2.0, previews[0].TakenDays, "the other school's day counts with the previewed one")
			summary, err := school.AllowanceSummary(ctx, miraSouth.ID, southType, 2027)
			require.NoError(t, err)
			assert.True(t, summary.KeptByTraeger, "the school reads that the Träger keeps the account")
			assert.Equal(t, 1.0, summary.TakenDays)
			return nil
		}))
		require.NoError(t, inSchool(t, unit, south, func(ctx context.Context) error {
			_, err := school.PreviewAllowanceBooking(ctx, miraSouth.ID, southType, "2027-03-03", "2027-03-04", false)
			assert.ErrorIs(t, err, workforce.ErrAbsenceTypeAllowanceExceeded,
				"the north school's day counts at the south school too, even on the same date")
			return nil
		}))
		bookAbsence(t, db, south, miraSouth.ID, southType, "2027-04-05", "2027-04-05", "requested")
		require.NoError(t, inSchool(t, unit, north, func(ctx context.Context) error {
			_, err := school.PreviewAllowanceBooking(ctx, miraNorth.ID, northType, "2027-05-03", "2027-05-03", true)
			assert.ErrorIs(t, err, workforce.ErrAbsenceTypeAllowanceExceeded, "an open request holds its day until the Leitung decides")
			return nil
		}))
	})

	t.Run("the check holds the Kontingent until the school's transaction ends", func(t *testing.T) {
		key := fmt.Sprintf("workforce.absence_pool:%d:%d", record.ID, regeneration.ID)
		free := func() bool {
			var got bool
			require.NoError(t, db.NewRaw(`SELECT pg_try_advisory_xact_lock(hashtextextended(?, 0))`, key).Scan(context.Background(), &got))
			return got
		}
		require.NoError(t, inSchool(t, unit, north, func(ctx context.Context) error {
			_, err := school.PreviewAllowanceBooking(ctx, miraNorth.ID, northType, "2027-09-06", "2027-09-06", true)
			assert.ErrorIs(t, err, workforce.ErrAbsenceTypeAllowanceExceeded, "nothing is left of the standard")
			assert.False(t, free(), "another school waits while this booking is checked")
			return nil
		}))
		assert.True(t, free(), "the lock ends with the transaction")
	})

	t.Run("a school deviates only for its own Einsätze and never from what the Träger keeps", func(t *testing.T) {
		limit := 0.5
		require.NoError(t, inSchool(t, unit, south, func(ctx context.Context) error {
			name := "Regeneration"
			_, err := school.UpdateAbsenceType(ctx, workforce.UpdateAbsenceType{ID: southType, Name: &name})
			assert.ErrorIs(t, err, workforce.ErrAbsenceTypeKeptByTraeger)
			_, err = school.UpdateAbsenceType(ctx, workforce.UpdateAbsenceType{ID: southType, SchoolLimit: &workforce.SchoolLimitPatch{Days: &limit}})
			require.NoError(t, err)
			_, err = school.SetAllowance(ctx, workforce.SetAbsenceTypeAllowance{
				StaffID: miraSouth.ID, AbsenceTypeID: southType, Year: 2027, EntitledDays: 9, Reason: "mehr", ChangedBy: miraSouth.ID,
			})
			assert.ErrorIs(t, err, workforce.ErrAbsenceTypeKeptByTraeger, "the Träger keeps the Kontingent of a person with a Personalakte")
			return nil
		}))
		rec := traegerJSON(t, router, office.token, http.MethodPut, fmt.Sprintf("/traeger/staff-records/%d/absence-accounts/%d", record.ID, regeneration.ID),
			map[string]any{"year": 2027, "entitled_days": 5, "reason": "Vereinbarung"})
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		require.NoError(t, inSchool(t, unit, south, func(ctx context.Context) error {
			_, err := school.PreviewAllowanceBooking(ctx, miraSouth.ID, southType, "2027-06-07", "2027-06-07", false)
			assert.ErrorIs(t, err, workforce.ErrAbsenceTypeSchoolLimitExceeded, "the south school allows half a day, its request already holds one")
			return nil
		}))
		require.NoError(t, inSchool(t, unit, north, func(ctx context.Context) error {
			_, err := school.PreviewAllowanceBooking(ctx, miraNorth.ID, northType, "2027-06-07", "2027-06-08", false)
			assert.NoError(t, err, "the south school's limit does not bind the north school")
			return nil
		}))
	})

	t.Run("the Personalverwaltung reads the Kontingent over all schools with each school's share", func(t *testing.T) {
		rec := traegerJSON(t, router, office.token, http.MethodGet, fmt.Sprintf("/traeger/staff-records/%d/absence-accounts?year=2027", record.ID), nil)
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		accounts := decode[traegerAbsenceAccountsBody](t, rec)
		require.Len(t, accounts.Accounts, 1)
		account := accounts.Accounts[0]
		assert.Equal(t, 5.0, account.EntitledDays)
		assert.True(t, account.Individual)
		assert.Equal(t, 1.0, account.TakenDays)
		assert.Equal(t, 1.0, account.ReservedDays)
		assert.Equal(t, 3.0, account.RemainingDays)
		shares := map[int64][2]float64{}
		for _, share := range account.Schools {
			shares[share.SchoolID] = [2]float64{share.TakenDays, share.ReservedDays}
		}
		assert.Equal(t, map[int64][2]float64{north: {1, 0}, south: {0, 1}}, shares)
		entries := map[int64]int{}
		var rows []struct {
			TenantID int64 `bun:"tenant_id"`
		}
		require.NoError(t, db.NewRaw(`SELECT tenant_id FROM audit.data_access_log WHERE actor_role = 'traeger' AND metadata->>'view' = ?
			AND metadata->>'organization_id' = ?`, workforce.TraegerStaffViewAbsenceAccounts, fmt.Sprint(office.organization)).Scan(context.Background(), &rows))
		for _, row := range rows {
			entries[row.TenantID]++
		}
		assert.Equal(t, map[int64]int{north: 1, south: 1}, entries, "each Einsatzort logs the read")
		rec = traegerJSON(t, router, office.token, http.MethodPut, fmt.Sprintf("/traeger/staff-records/%d/absence-accounts/%d", record.ID, regeneration.ID),
			map[string]any{"year": 2027, "entitled_days": 1.5, "reason": "weniger"})
		assertStaffRefusal(t, rec, http.StatusConflict, "workforce.traeger_absence_allowance_below_booked")
	})

	t.Run("a booked type keeps its name", func(t *testing.T) {
		rec := traegerJSON(t, router, office.token, http.MethodPut, fmt.Sprintf("/traeger/absence-types/%d", regeneration.ID), map[string]any{
			"name": "Regeneration", "allowance_enabled": true, "standard_days": 2,
		})
		assertStaffRefusal(t, rec, http.StatusConflict, "workforce.traeger_absence_type_in_use")
		rec = traegerJSON(t, router, office.token, http.MethodPut, fmt.Sprintf("/traeger/absence-types/%d", regeneration.ID), map[string]any{
			"name": "Regenerationstag", "allowance_enabled": true, "standard_days": 3, "requestable": false,
		})
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		assert.Equal(t, 1, staffSchoolValue(t, db, `SELECT COUNT(*) FROM active.staff_absence_types WHERE id = ? AND requestable = false AND school_limit_days = 0.5`, southType),
			"the change reaches the school and keeps its deviation")
	})

	t.Run("no role without the right and no other Träger reaches the types", func(t *testing.T) {
		overviewOnly := newTraegerOffice(t, db, portal, "Träger Lesen", identityaccess.TraegerRoleReadOnly)
		rec := traegerJSON(t, router, overviewOnly.token, http.MethodGet, "/traeger/absence-types/", nil)
		assert.Equal(t, http.StatusForbidden, rec.Code, rec.Body.String())
		other := newTraegerOffice(t, db, portal, "Träger Anders", identityaccess.TraegerRolePersonnel)
		staffRelease(t, db, other.organization)
		rec = traegerJSON(t, router, other.token, http.MethodGet, "/traeger/absence-types/", nil)
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		assert.Empty(t, decode[workforce.TraegerAbsenceTypeList](t, rec).Types)
		rec = traegerJSON(t, router, other.token, http.MethodPut, fmt.Sprintf("/traeger/absence-types/%d", regeneration.ID), map[string]any{"name": "Fremd"})
		assertStaffRefusal(t, rec, http.StatusNotFound, "workforce.traeger_absence_type_not_found")
		rec = traegerJSON(t, router, other.token, http.MethodGet, fmt.Sprintf("/traeger/staff-records/%d/absence-accounts", record.ID), nil)
		assertStaffRefusal(t, rec, http.StatusNotFound, "workforce.traeger_staff_record_not_found")
	})
}

// TestTraegerAbsenceTypesQueryBudget pins the statements of the list of
// types and of the accounts of a Personalakte: flat in the number of types,
// bookings and Kontingente at a fixed set of schools.
func TestTraegerAbsenceTypesQueryBudget(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	router, _, _, _, office := newTraegerStaffFixture(t, db)
	staffRelease(t, db, office.organization)
	north, south := office.schools[0], office.schools[1]
	miraNorth, account := testpkg.CreateTestStaffWithAccountForTenant(t, db, north, "Mira", "Budget")
	miraSouth := testpkg.CreateTestStaffForExistingAccountInTenant(t, db, south, account.ID, "Mira", "Budget")
	rec := traegerJSON(t, router, office.token, http.MethodPost, "/traeger/staff-records/", map[string]any{
		"members": []map[string]int64{{"school_id": north, "staff_id": miraNorth.ID}, {"school_id": south, "staff_id": miraSouth.ID}},
	})
	require.Equal(t, http.StatusCreated, rec.Code, rec.Body.String())
	record := decode[staffRecordBody](t, rec)
	read := func(path string) testpkg.QueryMeasurement {
		counter := testpkg.CaptureQueriesForContext(t, db)
		req := httptest.NewRequest(http.MethodGet, path, nil)
		req.Header.Set("Authorization", "Bearer "+office.token)
		rec := httptest.NewRecorder()
		testpkg.MeasuredHTTPRequest(counter, router, rec, req.WithContext(counter.Context(req.Context())))
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		return counter.Measurement(counter.Selects(""))
	}
	created := 0
	add := func(n int) {
		for ; created < n; created++ {
			rec := traegerJSON(t, router, office.token, http.MethodPost, "/traeger/absence-types/", map[string]any{
				"name": fmt.Sprintf("Art %d", created), "allowance_enabled": true, "standard_days": 3, "carryover_until": "03-31",
			})
			require.Equal(t, http.StatusCreated, rec.Code, rec.Body.String())
			typeID := decode[traegerAbsenceTypeBody](t, rec).ID
			bookAbsence(t, db, north, miraNorth.ID, schoolTypeOf(t, db, north, typeID), "2027-03-03", "2027-03-03", "approved")
			bookAbsence(t, db, south, miraSouth.ID, schoolTypeOf(t, db, south, typeID), "2027-03-04", "2027-03-04", "requested")
		}
	}
	accountsPath := fmt.Sprintf("/traeger/staff-records/%d/absence-accounts?year=2027", record.ID)
	add(1)
	fewTypes, fewAccounts := read("/traeger/absence-types/"), read(accountsPath)
	add(4)
	assert.Len(t, read("/traeger/absence-types/").Statements, len(fewTypes.Statements), "the list loads set-based")
	assert.Len(t, read(accountsPath).Statements, len(fewAccounts.Statements), "the accounts load set-based")
	querybudgets.AssertQueryBudget(t, "api.traeger.absence_types", fewTypes)
	querybudgets.AssertQueryBudget(t, "api.traeger.absence_accounts", fewAccounts)
}
