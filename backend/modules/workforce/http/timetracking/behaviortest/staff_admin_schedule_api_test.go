package behaviortest

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/api/testutil"
	"github.com/moto-ogs/project-phoenix/modules/workforce"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// Weekday indices of the schedule contract (Monday = 0), mirroring the
// capability's DayOfWeek.
const (
	dayMonday  = 0
	dayTuesday = 1
)

// scheduleVersion reads the schedule form's version, as the Dienstplan tab
// does before it saves (ADR 0311).
func scheduleVersion(t *testing.T, ctx *testContext, token string, staffID int64) string {
	t.Helper()
	rr := testutil.ExecuteRequest(ctx.router, testutil.NewAuthenticatedRequest(t, http.MethodGet, fmt.Sprintf("/staff/%d/schedule", staffID), nil, testutil.WithJWTBearer(token)))
	require.Equal(t, http.StatusOK, rr.Code, rr.Body.String())
	var answer struct {
		Data struct {
			Version string `json:"version"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(rr.Body.Bytes(), &answer))
	require.NotEmpty(t, answer.Data.Version)
	return answer.Data.Version
}

func TestUpdateSchedule_SaveAsTemplateMaterializesAssignedSnapshot(t *testing.T) {
	t.Parallel()

	ctx := setupStaffRoute(t)

	staff := testpkg.CreateTestStaff(t, ctx.db, "ScheduleTemplate", "Clean")
	capability := newWorkforceCapability(t, ctx.db)

	require.NoError(t, capability.ReplaceStaffSchedule(testpkg.Ctx(t), workforce.ReplaceStaffSchedule{
		StaffID: staff.ID,
		Entries: []workforce.StaffWorkScheduleEntry{
			{
				WeekIndex:      0,
				RotationLength: 1,
				DayOfWeek:      dayMonday,
				TargetMinutes:  300,
			},
		},
	}))

	claims := testutil.DefaultTestClaims()
	claims.Permissions = []string{"time_tracking:manage"}
	token := testutil.MintTestJWT(t, claims)
	body := map[string]any{
		"mode":                 "custom",
		"rotation_length":      1,
		"rotation_anchor_date": "2026-06-01",
		"save_as_template":     fmt.Sprintf("Saved schedule template clean %d", staff.ID),
		"expected_version":     scheduleVersion(t, ctx, token, staff.ID),
		"entries": []map[string]any{
			{
				"week_index":     0,
				"day_of_week":    dayTuesday,
				"target_minutes": 360,
			},
		},
	}

	req := testutil.NewAuthenticatedRequest(t, http.MethodPut, fmt.Sprintf("/staff/%d/schedule", staff.ID), body, testutil.WithJWTBearer(token))
	rr := testutil.ExecuteRequest(ctx.router, req)
	testutil.AssertSuccessResponse(t, rr, http.StatusOK)

	activeRows, err := capability.CurrentStaffSchedule(testpkg.Ctx(t), staff.ID)
	require.NoError(t, err)
	require.Len(t, activeRows, 1)
	assert.Equal(t, dayTuesday, activeRows[0].DayOfWeek)
	assert.Equal(t, 360, activeRows[0].TargetMinutes)

	reloadedStaff, err := newWorkforceTestRepositories(t, ctx.db).FindStaff(testpkg.Ctx(t), staff.ID)
	require.NoError(t, err)
	require.NotNil(t, reloadedStaff.WorkTimeModelID)
	testpkg.OwnTestWorkTimeModel(t, ctx.db, *reloadedStaff.WorkTimeModelID)

	model, err := capability.FindWorkTimeModel(testpkg.Ctx(t), *reloadedStaff.WorkTimeModelID)
	require.NoError(t, err)
	require.Len(t, model.Entries, 1)
	assert.Equal(t, dayTuesday, model.Entries[0].DayOfWeek)
	assert.Equal(t, 360, model.Entries[0].TargetMinutes)
}

func TestGetSchedule_AllowsOwnStaffWithTimeTrackingOwn(t *testing.T) {
	t.Parallel()

	ctx := setupStaffRoute(t)

	staff, account := testpkg.CreateTestStaffWithAccount(t, ctx.db, "ScheduleOwn", "Read")
	capability := newWorkforceCapability(t, ctx.db)

	require.NoError(t, capability.ReplaceStaffSchedule(testpkg.Ctx(t), workforce.ReplaceStaffSchedule{
		StaffID: staff.ID,
		Entries: []workforce.StaffWorkScheduleEntry{
			{
				WeekIndex:      0,
				RotationLength: 1,
				DayOfWeek:      dayMonday,
				TargetMinutes:  300,
			},
		},
	}))

	claims := testutil.DefaultTestClaims()
	claims.ID = int(account.ID)
	claims.Permissions = []string{"time_tracking:own"}
	token := testutil.MintTestJWT(t, claims)

	req := testutil.NewAuthenticatedRequest(t, http.MethodGet, fmt.Sprintf("/staff/%d/schedule", staff.ID), nil, testutil.WithJWTBearer(token))
	rr := testutil.ExecuteRequest(ctx.router, req)

	testutil.AssertSuccessResponse(t, rr, http.StatusOK)
}

func TestGetSchedule_RejectsOtherStaffWithTimeTrackingOwn(t *testing.T) {
	t.Parallel()

	ctx := setupStaffRoute(t)

	_, account := testpkg.CreateTestStaffWithAccount(t, ctx.db, "ScheduleOwn", "Only")
	otherStaff := testpkg.CreateTestStaff(t, ctx.db, "ScheduleOther", "Denied")

	claims := testutil.DefaultTestClaims()
	claims.ID = int(account.ID)
	claims.Permissions = []string{"time_tracking:own"}
	token := testutil.MintTestJWT(t, claims)

	req := testutil.NewAuthenticatedRequest(t, http.MethodGet, fmt.Sprintf("/staff/%d/schedule", otherStaff.ID), nil, testutil.WithJWTBearer(token))
	rr := testutil.ExecuteRequest(ctx.router, req)

	testutil.AssertErrorResponse(t, rr, http.StatusForbidden)
}

// The own Zeiterfassung exports through /staff/{id}/time-tracking/export
// (#4748): time_tracking:own reaches the own record and nobody else's.
func TestExportStaffSessions_AllowsOwnStaffWithTimeTrackingOwn(t *testing.T) {
	t.Parallel()

	ctx := setupStaffRoute(t)

	staff, account := testpkg.CreateTestStaffWithAccount(t, ctx.db, "ExportOwn", "Read")

	claims := testutil.DefaultTestClaims()
	claims.ID = int(account.ID)
	claims.Permissions = []string{"time_tracking:own"}
	token := testutil.MintTestJWT(t, claims)

	req := testutil.NewAuthenticatedRequest(t, http.MethodGet, fmt.Sprintf("/staff/%d/time-tracking/export?from=2026-09-01&to=2026-09-07&format=csv", staff.ID), nil, testutil.WithJWTBearer(token))
	rr := testutil.ExecuteRequest(ctx.router, req)

	require.Equal(t, http.StatusOK, rr.Code, rr.Body.String())
	require.Contains(t, rr.Header().Get("Content-Disposition"), "attachment")
}

func TestExportStaffSessions_RejectsOtherStaffWithTimeTrackingOwn(t *testing.T) {
	t.Parallel()

	ctx := setupStaffRoute(t)

	_, account := testpkg.CreateTestStaffWithAccount(t, ctx.db, "ExportOwn", "Only")
	otherStaff := testpkg.CreateTestStaff(t, ctx.db, "ExportOther", "Denied")

	claims := testutil.DefaultTestClaims()
	claims.ID = int(account.ID)
	claims.Permissions = []string{"time_tracking:own"}
	token := testutil.MintTestJWT(t, claims)

	req := testutil.NewAuthenticatedRequest(t, http.MethodGet, fmt.Sprintf("/staff/%d/time-tracking/export?from=2026-09-01&to=2026-09-07&format=csv", otherStaff.ID), nil, testutil.WithJWTBearer(token))
	rr := testutil.ExecuteRequest(ctx.router, req)

	testutil.AssertErrorResponse(t, rr, http.StatusForbidden)
}

// =============================================================================
// GET STAFF GROUPS - INVALID ID TEST
// =============================================================================

// TestVacationQuotaWriteStaysOnTheTimeTrackingTier pins the gate on
// PUT /{id}/vacation/quota (#2906): the quota belongs to the time-tracking
// tier, which also owns reading it back and the Abwesenheiten tab that shows
// it. staff:manage — the personnel-record authority — must not be able to
// write a value it can never see.
func TestVacationQuotaWriteStaysOnTheTimeTrackingTier(t *testing.T) {
	t.Parallel()

	ctx := setupStaffRoute(t)
	colleague := testpkg.CreateTestStaff(t, ctx.db, "Urlaubs", "Kontingent")
	path := fmt.Sprintf("/staff/%d/vacation/quota", colleague.ID)
	body := map[string]interface{}{"year": testpkg.TodayDate().Year(), "entitled_days": 30, "reason": "Tarif"}

	refused := testutil.ExecuteRequest(ctx.router, testutil.NewAuthenticatedRequest(
		t, http.MethodPut, path, body, testutil.WithJWTBearer(authToken(t, "staff:manage"))))
	assert.Equal(t, http.StatusForbidden, refused.Code,
		"staff:manage must not write a quota it cannot read: %s", refused.Body.String())

	// The change is recorded against the editing staff member (#3256), so
	// the allowed caller is a real Leitung, not a bare token.
	leitungPerson, leitungAccount := testpkg.CreateTestPersonWithAccount(t, ctx.db, "Urlaubs", "Leitung")
	testpkg.CreateTestStaffForPerson(t, ctx.db, leitungPerson.ID)
	claims := testutil.DefaultTestClaims()
	claims.ID = int(leitungAccount.ID)
	claims.Permissions = []string{"time_tracking:manage"}
	leitung := testutil.MintTestJWT(t, claims)

	// The form sends the version of the claim it read (ADR 0311).
	body["expected_version"] = vacationQuotaVersion(t, ctx, leitung, colleague.ID, testpkg.TodayDate().Year())
	allowed := testutil.ExecuteRequest(ctx.router, testutil.NewAuthenticatedRequest(
		t, http.MethodPut, path, body, testutil.WithJWTBearer(leitung)))
	assert.Equal(t, http.StatusOK, allowed.Code, allowed.Body.String())
}

// A school that starts with moto mid-year enters the past as Nachträge; the
// first schedule has to reach back to them, or every past day is priced at a
// Soll of 0 and the Saldo shows the whole Ist (#3892).
func TestUpdateSchedule_FirstScheduleStartsOnValidFrom(t *testing.T) {
	t.Parallel()

	ctx := setupStaffRoute(t)
	staff := testpkg.CreateTestStaff(t, ctx.db, "ScheduleBackdated", "First")
	capability := newWorkforceCapability(t, ctx.db)

	claims := testutil.DefaultTestClaims()
	claims.Permissions = []string{"time_tracking:manage"}
	token := testutil.MintTestJWT(t, claims)
	put := func(validFrom string) int {
		body := map[string]any{
			"mode":            "custom",
			"rotation_length": 1,
			"valid_from":      validFrom,
			"entries": []map[string]any{
				{"week_index": 0, "day_of_week": dayMonday, "target_minutes": 480},
			},
			"expected_version": scheduleVersion(t, ctx, token, staff.ID),
		}
		req := testutil.NewAuthenticatedRequest(t, http.MethodPut, fmt.Sprintf("/staff/%d/schedule", staff.ID), body, testutil.WithJWTBearer(token))
		return testutil.ExecuteRequest(ctx.router, req).Code
	}

	assert.Equal(t, http.StatusBadRequest, put("2999-01-04"), "a future start is not supported")
	require.Equal(t, http.StatusOK, put("2025-09-01"))

	rows, err := capability.CurrentStaffSchedule(testpkg.Ctx(t), staff.ID)
	require.NoError(t, err)
	require.Len(t, rows, 1)
	assert.Equal(t, "2025-09-01", rows[0].ValidFrom)

	// The first version now prices those days; moving its start again would
	// change a Soll that was already shown.
	assert.Equal(t, http.StatusBadRequest, put("2025-08-01"))
	rows, err = capability.CurrentStaffSchedule(testpkg.Ctx(t), staff.ID)
	require.NoError(t, err)
	require.Len(t, rows, 1)
	assert.Equal(t, "2025-09-01", rows[0].ValidFrom)
}

func TestUpdateSchedule_RejectsFutureValidFromForEmptyCustomSchedule(t *testing.T) {
	t.Parallel()

	ctx := setupStaffRoute(t)
	capability := newWorkforceCapability(t, ctx.db)
	claims := testutil.DefaultTestClaims()
	claims.Permissions = []string{"time_tracking:manage"}
	token := testutil.MintTestJWT(t, claims)

	for _, test := range []struct {
		name    string
		entries []map[string]any
	}{
		{name: "no entries", entries: []map[string]any{}},
		{name: "only zero targets", entries: []map[string]any{{"week_index": 0, "day_of_week": dayMonday, "target_minutes": 0}}},
	} {
		t.Run(test.name, func(t *testing.T) {
			staff := testpkg.CreateTestStaff(t, ctx.db, "ScheduleFuture", test.name)
			require.NoError(t, capability.ReplaceStaffSchedule(testpkg.Ctx(t), workforce.ReplaceStaffSchedule{
				StaffID: staff.ID,
				Entries: []workforce.StaffWorkScheduleEntry{{
					WeekIndex: 0, RotationLength: 1, DayOfWeek: dayMonday, TargetMinutes: 480,
				}},
			}))

			body := map[string]any{
				"mode": "custom", "rotation_length": 1, "valid_from": "2999-01-04", "entries": test.entries,
				"expected_version": scheduleVersion(t, ctx, token, staff.ID),
			}
			req := testutil.NewAuthenticatedRequest(t, http.MethodPut, fmt.Sprintf("/staff/%d/schedule", staff.ID), body, testutil.WithJWTBearer(token))
			rr := testutil.ExecuteRequest(ctx.router, req)
			assert.Equal(t, http.StatusBadRequest, rr.Code, rr.Body.String())

			rows, err := capability.CurrentStaffSchedule(testpkg.Ctx(t), staff.ID)
			require.NoError(t, err)
			require.Len(t, rows, 1, "the rejected write must not close the current schedule")
			assert.Equal(t, 480, rows[0].TargetMinutes)
		})
	}
}

// An archived template is no longer offered for new assignments (#6891). A
// person already bound to it keeps it and can save that choice again.
func TestUpdateSchedule_ArchivedTemplateOnlyKeepsExistingAssignees(t *testing.T) {
	t.Parallel()

	ctx := setupStaffRoute(t)
	capability := newWorkforceCapability(t, ctx.db)
	catalog, ok := capability.(workforce.WorkTimeModelCatalog)
	require.True(t, ok, "the composed capability serves the template catalog")
	model, err := capability.CreateWorkTimeModel(testpkg.Ctx(t), workforce.CreateWorkTimeModel{WorkTimeModelFields: workforce.WorkTimeModelFields{
		Name: "Archivierte Vorlage", RotationLength: 1, RotationAnchorDate: "2026-06-01",
		Entries: []workforce.WorkTimeModelEntry{{WeekIndex: 0, DayOfWeek: dayMonday, TargetMinutes: 300}},
	}})
	require.NoError(t, err)
	testpkg.OwnTestWorkTimeModel(t, ctx.db, model.ID)

	claims := testutil.DefaultTestClaims()
	claims.Permissions = []string{"time_tracking:manage"}
	token := testutil.MintTestJWT(t, claims)
	assign := func(staffID int64) *http.Response {
		body := map[string]any{"mode": "template", "model_id": model.ID, "expected_version": scheduleVersion(t, ctx, token, staffID)}
		req := testutil.NewAuthenticatedRequest(t, http.MethodPut, fmt.Sprintf("/staff/%d/schedule", staffID), body, testutil.WithJWTBearer(token))
		return testutil.ExecuteRequest(ctx.router, req).Result()
	}

	bound := testpkg.CreateTestStaff(t, ctx.db, "ArchivedTemplate", "Bound")
	newcomer := testpkg.CreateTestStaff(t, ctx.db, "ArchivedTemplate", "Newcomer")
	require.Equal(t, http.StatusOK, assign(bound.ID).StatusCode)

	_, err = catalog.ArchiveWorkTimeModel(testpkg.Ctx(t), model.ID)
	require.NoError(t, err)

	refused := assign(newcomer.ID)
	assert.Equal(t, http.StatusConflict, refused.StatusCode, "an archived template is not assigned anew")
	var problem struct {
		Code string `json:"code"`
	}
	require.NoError(t, json.NewDecoder(refused.Body).Decode(&problem))
	assert.Equal(t, "workforce.work_time_model_archived", problem.Code, "the refusal names its own code")
	rows, err := capability.CurrentStaffSchedule(testpkg.Ctx(t), newcomer.ID)
	require.NoError(t, err)
	assert.Empty(t, rows, "the refused assignment writes no schedule")

	assert.Equal(t, http.StatusOK, assign(bound.ID).StatusCode, "an existing assignee keeps the template")

	_, err = catalog.RestoreWorkTimeModel(testpkg.Ctx(t), model.ID)
	require.NoError(t, err)
	assert.Equal(t, http.StatusOK, assign(newcomer.ID).StatusCode, "a restored template is offered again")
}

// TestUpdateSchedule_RefusesAScheduleChangedSinceItWasRead pins ADR 0311 on
// PUT /staff/{id}/schedule: a schedule saved after the form read it refuses
// the save with general.changed_since_read and keeps the stored rows, an
// empty version too; the save's answer carries the next save.
func TestUpdateSchedule_RefusesAScheduleChangedSinceItWasRead(t *testing.T) {
	t.Parallel()

	ctx := setupStaffRoute(t)
	staff := testpkg.CreateTestStaff(t, ctx.db, "ScheduleRead", "Stale")
	capability := newWorkforceCapability(t, ctx.db)
	claims := testutil.DefaultTestClaims()
	claims.Permissions = []string{"time_tracking:manage"}
	token := testutil.MintTestJWT(t, claims)
	put := func(minutes int, version string) *httptest.ResponseRecorder {
		t.Helper()
		body := map[string]any{
			"mode": "custom", "rotation_length": 1, "expected_version": version,
			"entries": []map[string]any{{"week_index": 0, "day_of_week": dayMonday, "target_minutes": minutes}},
		}
		return testutil.ExecuteRequest(ctx.router, testutil.NewAuthenticatedRequest(t, http.MethodPut, fmt.Sprintf("/staff/%d/schedule", staff.ID), body, testutil.WithJWTBearer(token)))
	}

	shown := scheduleVersion(t, ctx, token, staff.ID)
	saved := put(300, scheduleVersion(t, ctx, token, staff.ID))
	require.Equal(t, http.StatusOK, saved.Code, saved.Body.String())

	for name, version := range map[string]string{"stale": shown, "empty": ""} {
		refused := put(480, version)
		require.Equal(t, http.StatusConflict, refused.Code, "%s: %s", name, refused.Body.String())
		assert.Contains(t, refused.Body.String(), "general.changed_since_read", name)
	}
	rows, err := capability.CurrentStaffSchedule(testpkg.Ctx(t), staff.ID)
	require.NoError(t, err)
	require.Len(t, rows, 1)
	assert.Equal(t, 300, rows[0].TargetMinutes, "the refused saves wrote nothing")

	var answer struct {
		Data struct {
			Version string `json:"version"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(saved.Body.Bytes(), &answer))
	assert.Equal(t, scheduleVersion(t, ctx, token, staff.ID), answer.Data.Version, "the save answers the version of what it stored")
	again := put(360, answer.Data.Version)
	require.Equal(t, http.StatusOK, again.Code, again.Body.String())
}
