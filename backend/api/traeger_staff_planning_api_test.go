// Router-level test for the Einsatzplanung over all Einsatzorte (#4708, ADR
// 0089 section 8, ADR 0242): the Personalverwaltung plans a person at each
// of its schools, and every shift is a shift of the school's Dienstplan.
// Whoever plans, the Träger or the school, is checked over all Einsatzorte:
// an overlap with another school is refused, a working-time violation needs
// a confirmation and a reason that lands in the Änderungsprotokoll. The
// rules and the switch „Einsatzplanung in moto“ are Träger values. A role
// without the right gets 403, no Träger reaches another Träger's people, and
// every read and write logs its access at the school.
package api

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"

	"github.com/moto-ogs/project-phoenix/api/testutil"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess"
	"github.com/moto-ogs/project-phoenix/modules/workforce"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	querybudgets "github.com/moto-ogs/project-phoenix/test/query-budgets"
)

type planningRefusal struct {
	Code    string `json:"code"`
	Details struct {
		Warnings []struct {
			Kind        string `json:"kind"`
			Date        string `json:"date"`
			Minutes     int    `json:"minutes"`
			Limit       int    `json:"limit"`
			NeedsReason bool   `json:"needs_reason"`
		} `json:"warnings"`
		ReasonRequired bool   `json:"reason_required"`
		Start          string `json:"start"`
		End            string `json:"end"`
		Day            string `json:"day"`
	} `json:"details"`
}

type planningWeekBody struct {
	WeekStart string `json:"week_start"`
	Rules     struct {
		Enabled        bool `json:"enabled"`
		MinRestMinutes int  `json:"min_rest_minutes"`
	} `json:"rules"`
	People []struct {
		RecordID wireID `json:"staff_record_id"`
		LastName string `json:"last_name"`
		Sites    []struct {
			SchoolID wireID `json:"school_id"`
		} `json:"sites"`
		Shifts []struct {
			ID               wireID `json:"id"`
			SchoolID         wireID `json:"school_id"`
			SchoolName       string `json:"school_name"`
			Date             string `json:"date"`
			StartTime        string `json:"start_time"`
			PlannedByTraeger bool   `json:"planned_by_traeger"`
		} `json:"shifts"`
		PlannedMinutes int  `json:"planned_minutes"`
		SollMinutes    *int `json:"soll_minutes"`
		SollDays       []struct {
			SchoolID wireID `json:"school_id"`
			Date     string `json:"date"`
			Minutes  int    `json:"minutes"`
		} `json:"soll_days"`
		AbsentDays []struct {
			SchoolID wireID `json:"school_id"`
			Date     string `json:"date"`
		} `json:"absent_days"`
		Warnings []struct {
			Kind string `json:"kind"`
		} `json:"warnings"`
	} `json:"people"`
}

func planningRefusalOf(t *testing.T, rec *httptest.ResponseRecorder) planningRefusal {
	t.Helper()
	var refusal planningRefusal
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &refusal), rec.Body.String())
	return refusal
}

// schoolShift plans a shift in the school's own Dienstplan as its admin.
func schoolShift(t *testing.T, router http.Handler, schoolID, accountID int64, body map[string]any) *httptest.ResponseRecorder {
	t.Helper()
	claims := testutil.DefaultTestClaims()
	claims.ID, claims.TenantID, claims.IsAdmin = int(accountID), schoolID, false
	claims.Permissions = []string{"time_tracking:manage"}
	payload, err := json.Marshal(body)
	require.NoError(t, err)
	req := httptest.NewRequest(http.MethodPost, "/staff-shifts/", bytes.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+testutil.MintTestJWT(t, claims))
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	return rec
}

func shiftColumn(t *testing.T, db *bun.DB, query string, args ...any) string {
	t.Helper()
	var value string
	require.NoError(t, db.NewRaw(query, args...).Scan(context.Background(), &value))
	return value
}

func TestTraegerStaffPlanningChecksEveryEinsatzort(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	today := time.Date(2026, time.November, 18, 12, 0, 0, 0, calendar.Berlin)
	rules := &StaffPlanningTestRules{}
	router, portal, _, _, office, schoolRouter := newTraegerStaffFixtureWith(t, db, func() time.Time { return today }, rules)
	schoolShifts := testpkg.TenantRuntimeMiddleware(t, db)(schoolRouter)
	north, south := office.schools[0], office.schools[1]
	staffRelease(t, db, office.organization)

	miraNorth, account := testpkg.CreateTestStaffWithAccountForTenant(t, db, north, "Mira", "Sommer")
	miraSouth := testpkg.CreateTestStaffForExistingAccountInTenant(t, db, south, account.ID, "Mira", "Sommer")
	jonas := testpkg.CreateTestStaffForTenant(t, db, south, "Jonas", "Keller")
	_, northLead := testpkg.CreateTestStaffWithAccountForTenant(t, db, north, "Lea", "Leitung")

	rec := traegerJSON(t, router, office.token, http.MethodPost, "/traeger/staff-records/", map[string]any{
		"members": []map[string]int64{{"school_id": north, "staff_id": miraNorth.ID}, {"school_id": south, "staff_id": miraSouth.ID}},
	})
	require.Equal(t, http.StatusCreated, rec.Code, rec.Body.String())
	recordID := decode[staffRecordBody](t, rec).ID
	rec = traegerJSON(t, router, office.token, http.MethodPost, fmt.Sprintf("/traeger/staff-records/%d/contracts", recordID), map[string]any{
		"kind": "part_time", "starts_on": "2026-08-01",
		"sites": []map[string]any{
			{"school_id": north, "staff_id": miraNorth.ID, "weekday_minutes": []int{300, 300, 300, 300, 0}},
			{"school_id": south, "staff_id": miraSouth.ID, "weekday_minutes": []int{0, 0, 0, 0, 240}},
		},
	})
	require.Equal(t, http.StatusCreated, rec.Code, rec.Body.String())
	shifts := fmt.Sprintf("/traeger/staff-planning/records/%d/shifts", recordID)
	siteShift := func(schoolID, shiftID int64) string {
		return fmt.Sprintf("/traeger/staff-planning/records/%d/schools/%d/shifts/%d", recordID, schoolID, shiftID)
	}

	t.Run("the school plans its morning as before", func(t *testing.T) {
		rec := schoolShift(t, schoolShifts, north, northLead.ID, map[string]any{
			"staff_id": miraNorth.ID, "date": "2026-11-23", "start_time": "08:00", "end_time": "13:00", "break_minutes": 0,
		})
		require.Equal(t, http.StatusCreated, rec.Code, rec.Body.String())
		rec = schoolShift(t, schoolShifts, south, account.ID, map[string]any{
			"staff_id": jonas.ID, "date": "2026-11-23", "start_time": "07:00", "end_time": "19:00", "break_minutes": 60,
		})
		require.Equal(t, http.StatusCreated, rec.Code, "a person without Personalakte keeps the checks of the school: %s", rec.Body.String())
	})

	var afternoonID int64
	t.Run("the Träger cannot plan the same hours at another Einsatzort", func(t *testing.T) {
		rec := traegerJSON(t, router, office.token, http.MethodPost, shifts, map[string]any{
			"school_id": strconv.FormatInt(south, 10), "date": "2026-11-23", "start_time": "12:00", "end_time": "16:00",
		})
		require.Equal(t, http.StatusConflict, rec.Code, rec.Body.String())
		refusal := planningRefusalOf(t, rec)
		assert.Equal(t, "workforce.shift_overlaps_other_site", refusal.Code)
		assert.Equal(t, "08:00", refusal.Details.Start)
		assert.Equal(t, "13:00", refusal.Details.End)
		assert.Equal(t, "23.11.2026", refusal.Details.Day)
		assert.Equal(t, 0, staffSchoolValue(t, db, `SELECT COUNT(*) FROM schedule.staff_shifts WHERE tenant_id = ? AND staff_id = ?`, south, miraSouth.ID))
	})

	t.Run("a working-time violation needs a confirmation with reason", func(t *testing.T) {
		afternoon := map[string]any{"school_id": strconv.FormatInt(south, 10), "date": "2026-11-23", "start_time": "13:30", "end_time": "18:00"}
		rec := traegerJSON(t, router, office.token, http.MethodPost, shifts, afternoon)
		require.Equal(t, http.StatusConflict, rec.Code, rec.Body.String())
		refusal := planningRefusalOf(t, rec)
		assert.Equal(t, "workforce.shift_working_time_warning", refusal.Code)
		require.Len(t, refusal.Details.Warnings, 1)
		assert.Equal(t, "break_too_short", refusal.Details.Warnings[0].Kind, "9.5 hours over both schools need 45 minutes of break")
		assert.Equal(t, 30, refusal.Details.Warnings[0].Minutes)
		assert.Equal(t, 45, refusal.Details.Warnings[0].Limit)
		assert.True(t, refusal.Details.ReasonRequired)

		afternoon["working_time_confirmed"] = true
		rec = traegerJSON(t, router, office.token, http.MethodPost, shifts, afternoon)
		require.Equal(t, http.StatusConflict, rec.Code, rec.Body.String())
		assert.True(t, planningRefusalOf(t, rec).Details.ReasonRequired, "a confirmation without a reason is not enough")

		afternoon["working_time_reason"] = "Vertretung für eine kranke Kollegin"
		rec = traegerJSON(t, router, office.token, http.MethodPost, shifts, afternoon)
		require.Equal(t, http.StatusCreated, rec.Code, rec.Body.String())
		afternoonID = int64(decode[struct {
			ID wireID `json:"id"`
		}](t, rec).ID)
		assert.Equal(t, "true|", shiftColumn(t, db, `SELECT planned_by_traeger::text || '|' || COALESCE(created_by::text, '') FROM schedule.staff_shifts WHERE id = ?`, afternoonID),
			"the shift is the school's, planned by the Träger without a planning staff member")
		assert.Equal(t, "Vertretung für eine kranke Kollegin", shiftColumn(t, db, `SELECT reason FROM audit.deviation_events
			WHERE tenant_id = ? AND staff_shift_id = ? AND event_type = 'working_time_override'`, south, afternoonID))
	})

	t.Run("the school sees the shifts of the other Einsatzort when it plans", func(t *testing.T) {
		rec := schoolShift(t, schoolShifts, north, northLead.ID, map[string]any{
			"staff_id": miraNorth.ID, "date": "2026-11-24", "start_time": "04:30", "end_time": "09:00", "break_minutes": 0,
		})
		require.Equal(t, http.StatusConflict, rec.Code, rec.Body.String())
		refusal := planningRefusalOf(t, rec)
		assert.Equal(t, "workforce.shift_working_time_warning", refusal.Code)
		require.Len(t, refusal.Details.Warnings, 1)
		assert.Equal(t, "rest_period", refusal.Details.Warnings[0].Kind)
		assert.Equal(t, 630, refusal.Details.Warnings[0].Minutes, "south ends at 18:00, north would start at 04:30")

		rec = schoolShift(t, schoolShifts, north, northLead.ID, map[string]any{
			"staff_id": miraNorth.ID, "date": "2026-11-24", "start_time": "12:00", "end_time": "17:00", "break_minutes": 0,
		})
		require.Equal(t, http.StatusCreated, rec.Code, rec.Body.String())
	})

	t.Run("the week shows every Einsatzort with Soll and warnings", func(t *testing.T) {
		// Vacation at north on Thursday and Friday: the contract suggests no
		// shift there (#7381); Friday has no Soll at north and stays private.
		_, err := db.ExecContext(context.Background(), `INSERT INTO active.staff_absences
			(tenant_id, staff_id, absence_type, date_start, date_end, status, created_by, requested_at)
			VALUES (?, ?, ?, '2026-11-26', '2026-11-27', 'approved', ?, NOW())`, north, miraNorth.ID, workforce.AbsenceTypeVacation, miraNorth.ID)
		require.NoError(t, err)
		rec := traegerJSON(t, router, office.token, http.MethodGet, "/traeger/staff-planning/?week=2026-11-25", nil)
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		week := decode[planningWeekBody](t, rec)
		assert.Equal(t, "2026-11-23", week.WeekStart)
		assert.True(t, week.Rules.Enabled)
		assert.Equal(t, 660, week.Rules.MinRestMinutes)
		require.Len(t, week.People, 1, "only people with a Personalakte are planned by the Träger")
		mira := week.People[0]
		assert.Equal(t, recordID, mira.RecordID)
		assert.Len(t, mira.Sites, 2)
		require.Len(t, mira.Shifts, 3)
		assert.Equal(t, "13:30", mira.Shifts[1].StartTime)
		assert.True(t, mira.Shifts[1].PlannedByTraeger)
		assert.Equal(t, 300+270+300, mira.PlannedMinutes)
		require.NotNil(t, mira.SollMinutes)
		assert.Equal(t, 4*300+240, *mira.SollMinutes)
		require.Len(t, mira.SollDays, 5, "the contract is the template of the week: one day per school with Soll")
		assert.Equal(t, north, mira.SollDays[0].SchoolID)
		assert.Equal(t, "2026-11-23", mira.SollDays[0].Date)
		assert.Equal(t, 300, mira.SollDays[0].Minutes)
		assert.Equal(t, south, mira.SollDays[4].SchoolID)
		assert.Equal(t, "2026-11-27", mira.SollDays[4].Date)
		assert.Equal(t, 240, mira.SollDays[4].Minutes)
		require.Len(t, mira.AbsentDays, 1, "only a full absence day with Soll at the school, without its kind")
		assert.Equal(t, north, mira.AbsentDays[0].SchoolID)
		assert.Equal(t, "2026-11-26", mira.AbsentDays[0].Date)
		require.Len(t, mira.Warnings, 1)
		assert.Equal(t, "break_too_short", mira.Warnings[0].Kind)
		entries := staffAccessEntries(t, db, office.organization, "traeger_staff_records")
		assert.Positive(t, entries[north])
		assert.Positive(t, entries[south])
	})

	// #4718: the shown week as PDF, Excel and CSV, one row per person and a
	// column per day, logged as its own view at every school it shows.
	t.Run("the export holds the shown week and logs its own view", func(t *testing.T) {
		before := staffAccessViews(t, db, office.organization, workforce.TraegerStaffViewPlanningExport)
		rec := traegerJSON(t, router, office.token, http.MethodGet, "/traeger/staff-planning/export?week=2026-11-25", nil)
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		assert.Equal(t, "text/csv; charset=utf-8", rec.Header().Get("Content-Type"))
		body := strings.TrimPrefix(rec.Body.String(), "\xEF\xBB\xBF")
		lines := strings.Split(strings.TrimSpace(body), "\n")
		require.Len(t, lines, 2, body)
		assert.Equal(t, "Woche ab;Nachname;Vorname;Einsatzorte;Montag, 23.11.;Dienstag, 24.11.;Mittwoch, 25.11.;Donnerstag, 26.11.;"+
			"Freitag, 27.11.;Samstag, 28.11.;Sonntag, 29.11.;Geplant (Stunden);Soll (Stunden);Hinweise", strings.TrimSpace(lines[0]))
		assert.Equal(t, "23.11.2026;Sommer;Mira;Träger Personal OGS Nord, Träger Personal OGS Süd;"+
			`"08:00–13:00 Träger Personal OGS Nord; 13:30–18:00 Träger Personal OGS Süd";12:00–17:00 Träger Personal OGS Nord;;;;;;14,5;24;1`,
			strings.TrimSpace(lines[1]))
		after := staffAccessViews(t, db, office.organization, workforce.TraegerStaffViewPlanningExport)
		assert.Equal(t, map[int64]int{north: before[north] + 1, south: before[south] + 1}, after)

		assertTraegerListFormats(t, router, office.token, "/traeger/staff-planning/export?week=2026-11-25", "einsatzplanung-2026-11-23")
		logged := staffAccessViews(t, db, office.organization, workforce.TraegerStaffViewPlanningExport)
		assert.Equal(t, after[north]+2, logged[north], "the PDF and the Excel export are logged like the CSV")
		rec = traegerJSON(t, router, office.token, http.MethodGet, "/traeger/staff-planning/export?week=2026-11-25&format=xlsx", nil)
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		assertTraegerListNumbers(t, rec.Body.Bytes(), map[string]string{"L7": "14.5", "M7": "24", "N7": "1"})

		rec = traegerJSON(t, router, office.token, http.MethodGet, "/traeger/staff-planning/export?week=kw48", nil)
		assert.Equal(t, http.StatusBadRequest, rec.Code, rec.Body.String())
	})

	t.Run("a change keeps the school and clears the warning", func(t *testing.T) {
		rec := traegerJSON(t, router, office.token, http.MethodPut, fmt.Sprintf("%s/%d", shifts, afternoonID), map[string]any{
			"school_id": strconv.FormatInt(south, 10), "date": "2026-11-23", "start_time": "14:00", "end_time": "18:00",
		})
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		assert.Equal(t, "14:00:00", shiftColumn(t, db, `SELECT start_time::text FROM schedule.staff_shifts WHERE id = ?`, afternoonID))
	})

	t.Run("a shift of another school or person stays out of reach", func(t *testing.T) {
		rec := traegerJSON(t, router, office.token, http.MethodDelete, siteShift(north, afternoonID), nil)
		assertStaffRefusal(t, rec, http.StatusNotFound, "workforce.traeger_planning_shift_not_found")
		jonasShift := staffSchoolValue(t, db, `SELECT id FROM schedule.staff_shifts WHERE tenant_id = ? AND staff_id = ?`, south, jonas.ID)
		rec = traegerJSON(t, router, office.token, http.MethodDelete, siteShift(south, int64(jonasShift)), nil)
		assertStaffRefusal(t, rec, http.StatusNotFound, "workforce.traeger_planning_shift_not_found")
		rec = traegerJSON(t, router, office.token, http.MethodDelete, siteShift(south, afternoonID), nil)
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	})

	t.Run("no role without the right and no other Träger reaches the plan", func(t *testing.T) {
		billing := newTraegerOffice(t, db, portal, "Träger Abrechnung", identityaccess.TraegerRoleBilling)
		rec := traegerJSON(t, router, billing.token, http.MethodGet, "/traeger/staff-planning/", nil)
		assert.Equal(t, http.StatusForbidden, rec.Code, rec.Body.String())
		rec = traegerJSON(t, router, billing.token, http.MethodGet, "/traeger/staff-planning/export", nil)
		assert.Equal(t, http.StatusForbidden, rec.Code, rec.Body.String())
		other := newTraegerOffice(t, db, portal, "Anderer Träger", identityaccess.TraegerRolePersonnel)
		staffRelease(t, db, other.organization)
		rec = traegerJSON(t, router, other.token, http.MethodPost, shifts, map[string]any{
			"school_id": strconv.FormatInt(south, 10), "date": "2026-11-25", "start_time": "08:00", "end_time": "12:00",
		})
		assert.Equal(t, http.StatusBadRequest, rec.Code, "another Träger's school is no Einsatzort: %s", rec.Body.String())
		assert.Equal(t, "workforce.traeger_planning_site_invalid", refusalOf(t, rec).Code)
	})

	t.Run("switched off, nobody plans new shifts", func(t *testing.T) {
		rec := traegerJSON(t, router, office.token, http.MethodGet, "/traeger/staff-planning/future-shifts", nil)
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		assert.NotEmpty(t, decode[[]struct {
			SchoolID wireID `json:"school_id"`
			Shifts   int    `json:"shifts"`
		}](t, rec))
		rules.Off = true
		rec = traegerJSON(t, router, office.token, http.MethodPost, shifts, map[string]any{
			"school_id": strconv.FormatInt(south, 10), "date": "2026-11-27", "start_time": "08:00", "end_time": "12:00",
		})
		assertStaffRefusal(t, rec, http.StatusConflict, "workforce.shift_planning_off")
		rec = schoolShift(t, schoolShifts, north, northLead.ID, map[string]any{
			"staff_id": miraNorth.ID, "date": "2026-11-27", "start_time": "08:00", "end_time": "12:00", "break_minutes": 0,
		})
		assertStaffRefusal(t, rec, http.StatusConflict, "workforce.shift_planning_off")

		// A new cover is a new shift too; cancelling without one still works.
		cover := testpkg.CreateTestStaffForTenant(t, db, north, "Ole", "Vertretung")
		morning := staffSchoolValue(t, db, `SELECT id FROM schedule.staff_shifts WHERE tenant_id = ? AND staff_id = ? AND NOT cancelled ORDER BY date, start_time LIMIT 1`, north, miraNorth.ID)
		cancel := func(replacements []map[string]any) *httptest.ResponseRecorder {
			claims := testutil.DefaultTestClaims()
			claims.ID, claims.TenantID, claims.IsAdmin = int(northLead.ID), north, false
			claims.Permissions = []string{"time_tracking:manage"}
			payload, err := json.Marshal(map[string]any{"cancelled": true, "change_reason": "Krank", "replacements": replacements})
			require.NoError(t, err)
			req := httptest.NewRequest(http.MethodPut, fmt.Sprintf("/staff-shifts/%d/cancellation", morning), bytes.NewReader(payload))
			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("Authorization", "Bearer "+testutil.MintTestJWT(t, claims))
			out := httptest.NewRecorder()
			schoolShifts.ServeHTTP(out, req)
			return out
		}
		rec = cancel([]map[string]any{{"staff_id": cover.ID, "start_time": "08:00", "end_time": "12:00", "break_minutes": 0}})
		assertStaffRefusal(t, rec, http.StatusConflict, "workforce.shift_planning_off")
		rec = cancel([]map[string]any{})
		assert.Less(t, rec.Code, 300, "cancelling without a cover stays possible: %s", rec.Body.String())
	})
}

// TestTraegerStaffPlanningWeekQueryBudget pins the statements of the week
// plan: flat in the number of shifts and people at a fixed set of schools.
func TestTraegerStaffPlanningWeekQueryBudget(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	today := time.Date(2026, time.November, 18, 12, 0, 0, 0, calendar.Berlin)
	router, _, _, _, office, _ := newTraegerStaffFixtureWith(t, db, func() time.Time { return today }, &StaffPlanningTestRules{})
	staffRelease(t, db, office.organization)
	north, south := office.schools[0], office.schools[1]
	person := func(last string) int64 {
		atNorth, account := testpkg.CreateTestStaffWithAccountForTenant(t, db, north, "Mira", last)
		atSouth := testpkg.CreateTestStaffForExistingAccountInTenant(t, db, south, account.ID, "Mira", last)
		rec := traegerJSON(t, router, office.token, http.MethodPost, "/traeger/staff-records/", map[string]any{
			"members": []map[string]int64{{"school_id": north, "staff_id": atNorth.ID}, {"school_id": south, "staff_id": atSouth.ID}},
		})
		require.Equal(t, http.StatusCreated, rec.Code, rec.Body.String())
		return int64(decode[staffRecordBody](t, rec).ID)
	}
	plan := func(recordID, schoolID int64, date string) {
		rec := traegerJSON(t, router, office.token, http.MethodPost, fmt.Sprintf("/traeger/staff-planning/records/%d/shifts", recordID), map[string]any{
			"school_id": strconv.FormatInt(schoolID, 10), "date": date, "start_time": "08:00", "end_time": "12:00", "break_minutes": 0,
		})
		require.Equal(t, http.StatusCreated, rec.Code, rec.Body.String())
	}
	read := func(paths ...string) testpkg.QueryMeasurement {
		path := "/traeger/staff-planning/?week=2026-11-23"
		if len(paths) > 0 {
			path = paths[0]
		}
		counter := testpkg.CaptureQueriesForContext(t, db)
		req := httptest.NewRequest(http.MethodGet, path, nil)
		req.Header.Set("Authorization", "Bearer "+office.token)
		rec := httptest.NewRecorder()
		testpkg.MeasuredHTTPRequest(counter, router, rec, req.WithContext(counter.Context(req.Context())))
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		return counter.Measurement(counter.Selects(""))
	}
	first := person("Eins")
	plan(first, north, "2026-11-23")
	few, fewFuture := read(), read("/traeger/staff-planning/future-shifts")
	second := person("Zwei")
	plan(first, south, "2026-11-24")
	plan(second, north, "2026-11-25")
	plan(second, south, "2026-11-26")
	assert.Len(t, read().Statements, len(few.Statements), "the week loads set-based")
	assert.Len(t, read("/traeger/staff-planning/future-shifts").Statements, len(fewFuture.Statements), "the counts load set-based")
	querybudgets.AssertQueryBudget(t, "api.traeger.staff_planning_week", few)
	querybudgets.AssertQueryBudget(t, "api.traeger.staff_planning_future_shifts", fewFuture)
}
