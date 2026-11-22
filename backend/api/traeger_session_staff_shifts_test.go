// Router-level test of the school's Dienstplan in a session opened through
// the Träger-Portal (#7818, ADR 0084 section 5): the person holds the
// school's admin role and no staff record there. Every row it creates
// carries the mark of the Träger-Büro instead of a staff author; a shift it
// changes keeps its author and is marked as last changed by the Träger, as
// in the Träger-Portal. A person with a staff record still writes as staff,
// and any other account without one gets 403 with its code.
package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"

	"github.com/moto-ogs/project-phoenix/api/testutil"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess/sessiontoken"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

type traegerDienstplan struct {
	t      *testing.T
	db     *bun.DB
	router http.Handler
	tenant int64
}

func newTraegerDienstplan(t *testing.T) traegerDienstplan {
	t.Helper()
	db := testpkg.SetupTestDB(t)
	router, _, err := StaffPlanningTestComposition(testpkg.NewDatabase(t, db), &StaffPlanningTestRules{})
	require.NoError(t, err)
	return traegerDienstplan{t: t, db: db, router: testpkg.TenantRuntimeMiddleware(t, db)(router), tenant: testpkg.Tenant(t)}
}

// session is a school session of accountID; viaTraeger marks the Absprung.
func (d traegerDienstplan) session(accountID int64, viaTraeger bool) sessiontoken.AppClaims {
	claims := testutil.AdminTestClaimsForTenant(int(accountID), d.tenant)
	claims.ViaTraeger = viaTraeger
	return claims
}

func (d traegerDienstplan) send(claims sessiontoken.AppClaims, method, path string, body any) *httptest.ResponseRecorder {
	d.t.Helper()
	payload, err := json.Marshal(body)
	require.NoError(d.t, err)
	req := httptest.NewRequest(method, "/staff-shifts"+path, bytes.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+testutil.MintTestJWT(d.t, claims))
	rec := httptest.NewRecorder()
	d.router.ServeHTTP(rec, req)
	return rec
}

// author reads "<planned_by_traeger>|<created_by>" of a row.
func (d traegerDienstplan) author(table string, id int64) string {
	d.t.Helper()
	return shiftColumn(d.t, d.db, `SELECT planned_by_traeger::text || '|' || COALESCE(created_by::text, '') FROM `+table+` WHERE id = ?`, id)
}

func TestTraegerSessionWritesTheDienstplan(t *testing.T) {
	t.Parallel()
	d := newTraegerDienstplan(t)
	lead, leadAccount := testpkg.CreateTestStaffWithAccount(t, d.db, "Lea", "Leitung")
	ben := testpkg.CreateTestStaff(t, d.db, "Ben", "Frueh")
	jonas := testpkg.CreateTestStaff(t, d.db, "Jonas", "Keller")
	mira := testpkg.CreateTestStaff(t, d.db, "Mira", "Sommer")
	period := testpkg.CreateTestCalendarPeriod(t, d.db, fmt.Sprintf("Traeger-Dienstplan-%d", testpkg.UniqueSuffix()),
		testpkg.Date(2098, time.August, 1), testpkg.Date(2099, time.July, 31))
	traeger := d.session(testpkg.CreateTestAccount(t, d.db, "traeger-buero").ID, true)
	staffInTraegerSession := d.session(leadAccount.ID, true)
	expectStaff := fmt.Sprintf("false|%d", lead.ID)
	// A shift the Träger-Büro changed is marked as planned or last changed by
	// the Träger and keeps its staff author (#4708, #7818).
	markedStaff := fmt.Sprintf("true|%d", lead.ID)
	idOf := func(rec *httptest.ResponseRecorder) int64 {
		return int64(decode[struct {
			ID wireID `json:"id"`
		}](t, rec).ID)
	}
	seriesOf := func(rec *httptest.ResponseRecorder) int64 {
		return int64(decode[struct {
			SeriesID wireID `json:"series_id"`
		}](t, rec).SeriesID)
	}

	t.Run("the Träger-Büro plans a shift without a staff author", func(t *testing.T) {
		rec := d.send(traeger, http.MethodPost, "/", map[string]any{
			"staff_id": ben.ID, "date": "2098-09-01", "start_time": "08:00", "end_time": "12:00", "break_minutes": 0,
		})
		require.Equal(t, http.StatusCreated, rec.Code, rec.Body.String())
		assert.Equal(t, "true|", d.author("schedule.staff_shifts", idOf(rec)))
	})

	// staffShiftOn plans a shift of Ben on date as the staff member Lea.
	staffShiftOn := func(t *testing.T, date string) int64 {
		rec := d.send(staffInTraegerSession, http.MethodPost, "/", map[string]any{
			"staff_id": ben.ID, "date": date, "start_time": "08:00", "end_time": "12:00", "break_minutes": 0,
		})
		require.Equal(t, http.StatusCreated, rec.Code, rec.Body.String())
		return idOf(rec)
	}

	t.Run("a person with a staff record writes as staff in a session of the Träger", func(t *testing.T) {
		assert.Equal(t, expectStaff, d.author("schedule.staff_shifts", staffShiftOn(t, "2098-09-02")))
	})

	t.Run("a change of the Träger-Büro marks the shift and keeps its author", func(t *testing.T) {
		changed := staffShiftOn(t, "2098-09-03")
		rec := d.send(traeger, http.MethodPut, fmt.Sprintf("/%d", changed), map[string]any{
			"date": "2098-09-03", "start_time": "08:00", "end_time": "13:00", "break_minutes": 0,
		})
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		assert.Equal(t, markedStaff, d.author("schedule.staff_shifts", changed))
		assert.Equal(t, "13:00:00|", shiftColumn(t, d.db, `SELECT end_time::text || '|' || COALESCE(updated_by::text, '') FROM schedule.staff_shifts WHERE id = ?`, changed))

		// A later change by staff names the staff member and keeps the mark.
		rec = d.send(staffInTraegerSession, http.MethodPut, fmt.Sprintf("/%d", changed), map[string]any{
			"date": "2098-09-03", "start_time": "08:00", "end_time": "14:00", "break_minutes": 0,
		})
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		assert.Equal(t, markedStaff, d.author("schedule.staff_shifts", changed))
		assert.Equal(t, fmt.Sprintf("14:00:00|%d", lead.ID), shiftColumn(t, d.db, `SELECT end_time::text || '|' || COALESCE(updated_by::text, '') FROM schedule.staff_shifts WHERE id = ?`, changed))
	})

	t.Run("a move of the Träger-Büro marks the shift and keeps its author", func(t *testing.T) {
		moved := staffShiftOn(t, "2098-09-04")
		rec := d.send(traeger, http.MethodPut, fmt.Sprintf("/%d/move", moved), map[string]any{
			"source_staff_id": ben.ID, "target_staff_id": ben.ID, "date": "2098-09-05",
			"start_time": "08:00", "end_time": "13:00", "break_minutes": 0, "shift_type_id": nil,
		})
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		assert.Equal(t, markedStaff, d.author("schedule.staff_shifts", moved))
		assert.Equal(t, "2098-09-05|", shiftColumn(t, d.db, `SELECT date::text || '|' || COALESCE(updated_by::text, '') FROM schedule.staff_shifts WHERE id = ?`, moved))
	})

	t.Run("a cover the Träger-Büro creates has no staff author, the origin keeps its author", func(t *testing.T) {
		origin := staffShiftOn(t, "2098-09-09")
		rec := d.send(traeger, http.MethodPut, fmt.Sprintf("/%d/cancellation", origin), map[string]any{
			"cancelled": true, "change_reason": "krank",
			"replacements": []map[string]any{{"staff_id": jonas.ID, "start_time": "08:00", "end_time": "12:00", "break_minutes": 0}},
		})
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		assert.Equal(t, markedStaff, d.author("schedule.staff_shifts", origin))
		cover := staffSchoolValue(t, d.db, `SELECT id FROM schedule.staff_shifts WHERE tenant_id = ? AND origin_shift_id = ?`, d.tenant, origin)
		assert.Equal(t, "true|", d.author("schedule.staff_shifts", int64(cover)))
	})

	var traegerSeries int64
	t.Run("a series of the Träger-Büro and its occurrences carry the mark", func(t *testing.T) {
		rec := d.send(traeger, http.MethodPost, "/series", map[string]any{
			"staff_id": mira.ID, "weekdays": []int{1}, "start_time": "08:00", "end_time": "12:00", "break_minutes": 0,
			"calendar_period_id": period.ID, "valid_from": "2098-09-01", "valid_until": "2098-09-29",
		})
		require.Equal(t, http.StatusCreated, rec.Code, rec.Body.String())
		traegerSeries = seriesOf(rec)
		assert.Equal(t, "true|", d.author("schedule.staff_shift_series", traegerSeries))
		assert.Equal(t, "4|4", shiftColumn(t, d.db, `SELECT COUNT(*)::text || '|' || COUNT(*) FILTER (WHERE planned_by_traeger AND created_by IS NULL)::text
			FROM schedule.staff_shifts WHERE series_id = ?`, traegerSeries))
	})

	t.Run("the removed occurrence of a Träger series keeps the mark", func(t *testing.T) {
		occurrence := staffSchoolValue(t, d.db, `SELECT id FROM schedule.staff_shifts WHERE series_id = ? AND date = '2098-09-08'`, traegerSeries)
		rec := d.send(staffInTraegerSession, http.MethodDelete, fmt.Sprintf("/%d", occurrence), nil)
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		assert.Equal(t, "true|", shiftColumn(t, d.db, `SELECT planned_by_traeger::text || '|' || COALESCE(created_by::text, '')
			FROM schedule.staff_shift_series_exceptions WHERE series_id = ? AND date = '2098-09-08'`, traegerSeries))
	})

	t.Run("the successor of a split by the Träger-Büro carries the mark", func(t *testing.T) {
		rec := d.send(staffInTraegerSession, http.MethodPost, "/series", map[string]any{
			"staff_id": jonas.ID, "weekdays": []int{1}, "start_time": "08:00", "end_time": "12:00", "break_minutes": 0,
			"calendar_period_id": period.ID, "valid_from": "2098-09-01", "valid_until": "2098-09-29",
		})
		require.Equal(t, http.StatusCreated, rec.Code, rec.Body.String())
		staffSeries := seriesOf(rec)
		assert.Equal(t, expectStaff, d.author("schedule.staff_shift_series", staffSeries))

		rec = d.send(traeger, http.MethodPut, fmt.Sprintf("/series/%d/split", staffSeries), map[string]any{
			"effective_date": "2098-09-15", "start_time": "09:00", "end_time": "12:00", "break_minutes": 0,
		})
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		successor := seriesOf(rec)
		require.NotEqual(t, staffSeries, successor)
		assert.Equal(t, expectStaff, d.author("schedule.staff_shift_series", staffSeries))
		assert.Equal(t, "true|", d.author("schedule.staff_shift_series", successor))
		assert.Equal(t, "2|2", shiftColumn(t, d.db, `SELECT COUNT(*)::text || '|' || COUNT(*) FILTER (WHERE planned_by_traeger AND created_by IS NULL)::text
			FROM schedule.staff_shifts WHERE series_id = ?`, successor))
	})
}

// An account without a staff record that did not come through the
// Träger-Portal is refused with its code: the session is valid, so this is
// a missing staff profile (403), not a missing login (401, before #7818).
func TestDienstplanRefusesAStafflessAccountOutsideATraegerSession(t *testing.T) {
	t.Parallel()
	d := newTraegerDienstplan(t)
	ben := testpkg.CreateTestStaff(t, d.db, "Ben", "Ohneakte")
	claims := d.session(testpkg.CreateTestAccount(t, d.db, "ohne-personal").ID, false)

	rec := d.send(claims, http.MethodPost, "/", map[string]any{
		"staff_id": ben.ID, "date": "2098-09-01", "start_time": "08:00", "end_time": "12:00", "break_minutes": 0,
	})
	require.Equal(t, http.StatusForbidden, rec.Code, rec.Body.String())
	assert.Equal(t, "workforce.no_staff_profile", planningRefusalOf(t, rec).Code)
	assert.Zero(t, staffSchoolValue(t, d.db, `SELECT COUNT(*) FROM schedule.staff_shifts WHERE tenant_id = ? AND staff_id = ?`, d.tenant, ben.ID))
}
