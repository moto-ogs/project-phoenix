//go:build testhooks

package shifttypes_test

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/api"
	"github.com/moto-ogs/project-phoenix/api/testutil"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// These Dienstplan routes reach the browser through the catalog proxy
// (#2352); the tests drive them under their production paths.

func managerToken(t *testing.T, accountID int64) string {
	t.Helper()
	claims := testutil.DefaultTestClaims()
	claims.TenantID = testpkg.Tenant(t)
	// The week overview also needs schedules:read and users:read.
	claims.Permissions = []string{"time_tracking:manage", "schedules:read", "users:read"}
	claims.IsAdmin = false
	if accountID != 0 {
		claims.ID = int(accountID)
	}
	return testutil.MintTestJWT(t, claims)
}

// The example Schichtarten are seeded once; a second request adds none.
func TestShiftTypeDefaultsAreSeededOnce(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	types, references, _, err := api.NewShiftTypeTestModule(testpkg.NewDatabase(t, db))
	require.NoError(t, err)
	router := testpkg.MountedQueryBudgetRouter("/api/shift-types", api.NewShiftTypesRouterForBudgetTest(types, references))
	token := managerToken(t, 0)
	seed := func() []shiftTypeWire {
		t.Helper()
		response := testutil.ExecuteRequestForTest(t, router, testutil.NewAuthenticatedRequest(t, http.MethodPost, "/defaults", nil, testutil.WithJWTBearer(token)))
		require.Equal(t, http.StatusOK, response.Code, response.Body.String())
		var envelope struct {
			Data []shiftTypeWire `json:"data"`
		}
		require.NoError(t, json.Unmarshal(response.Body.Bytes(), &envelope))
		return envelope.Data
	}

	first := seed()
	require.NotEmpty(t, first, "the school gets example Schichtarten")
	assert.Len(t, seed(), len(first), "seeding again adds no type")
	var stored int
	require.NoError(t, db.NewRaw(`SELECT count(*) FROM schedule.shift_types WHERE tenant_id = ?`, testpkg.Tenant(t)).Scan(testpkg.Ctx(t), &stored))
	assert.Equal(t, len(first), stored)
}

// A planned shift is created, moved to a later window and deleted through
// the real planning composition; the week list shows each state.
func TestStaffShiftIsCreatedChangedAndDeletedThroughTheRoutes(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	shifts, err := api.StaffShiftGrowthTestRouter(testpkg.NewDatabase(t, db))
	require.NoError(t, err)
	router := testpkg.MountedQueryBudgetRouter("/api", testpkg.TenantRuntimeMiddleware(t, db)(shifts))
	_, account := testpkg.CreateTestStaffWithAccount(t, db, "Dienstplan", fmt.Sprintf("Leitung-%d", testpkg.UniqueSuffix()))
	testpkg.MapAccountToTenant(t, db, account.ID, testpkg.Tenant(t))
	staff := testpkg.CreateTestStaff(t, db, "Schicht", fmt.Sprintf("Kraft-%d", testpkg.UniqueSuffix()))
	token := managerToken(t, account.ID)
	type shift struct {
		ID        string `json:"id"`
		StartTime string `json:"start_time"`
		EndTime   string `json:"end_time"`
	}
	send := func(method, path string, body any) *httptest.ResponseRecorder {
		t.Helper()
		return testutil.ExecuteRequestForTest(t, router, testutil.NewAuthenticatedRequest(t, method, path, body, testutil.WithJWTBearer(token)))
	}
	week := func() []shift {
		t.Helper()
		response := send(http.MethodGet, fmt.Sprintf("/staff-shifts/?from=2026-07-06&to=2026-07-10&staff_id=%d", staff.ID), nil)
		require.Equal(t, http.StatusOK, response.Code, response.Body.String())
		var envelope struct {
			Data []shift `json:"data"`
		}
		require.NoError(t, json.Unmarshal(response.Body.Bytes(), &envelope))
		return envelope.Data
	}

	response := send(http.MethodPost, "/staff-shifts/", map[string]any{
		"staff_id": staff.ID, "date": "2026-07-06", "start_time": "08:00", "end_time": "12:00", "break_minutes": 0,
	})
	require.Equal(t, http.StatusCreated, response.Code, response.Body.String())
	var created struct {
		Data shift `json:"data"`
	}
	require.NoError(t, json.Unmarshal(response.Body.Bytes(), &created))

	response = send(http.MethodPut, "/staff-shifts/"+created.Data.ID, map[string]any{
		"date": "2026-07-06", "start_time": "09:00", "end_time": "13:00", "break_minutes": 0,
	})
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	assert.Equal(t, []shift{{ID: created.Data.ID, StartTime: "09:00", EndTime: "13:00"}}, week(), "the week shows the changed window")

	response = send(http.MethodDelete, "/staff-shifts/"+created.Data.ID, nil)
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	var deleted struct {
		Data struct {
			ID json.Number `json:"id"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(response.Body.Bytes(), &deleted))
	assert.Equal(t, created.Data.ID, deleted.Data.ID.String())
	assert.Empty(t, week(), "the deleted shift leaves the week")
}

// A shift moves to a colleague and is cancelled, the week overview shows it,
// and a weekly series is planned and continued from a later day, all through
// the real planning composition. The days lie in a future school year, so
// the series is planned regardless of the day the test runs.
func TestStaffShiftPlanningRoutesStoreThePlan(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	shifts, err := api.StaffShiftGrowthTestRouter(testpkg.NewDatabase(t, db))
	require.NoError(t, err)
	router := testpkg.MountedQueryBudgetRouter("/api", testpkg.TenantRuntimeMiddleware(t, db)(shifts))
	_, account := testpkg.CreateTestStaffWithAccount(t, db, "Planung", fmt.Sprintf("Leitung-%d", testpkg.UniqueSuffix()))
	testpkg.MapAccountToTenant(t, db, account.ID, testpkg.Tenant(t))
	first := testpkg.CreateTestStaff(t, db, "Erste", fmt.Sprintf("Kraft-%d", testpkg.UniqueSuffix()))
	second := testpkg.CreateTestStaff(t, db, "Zweite", fmt.Sprintf("Kraft-%d", testpkg.UniqueSuffix()))
	period := testpkg.CreateTestCalendarPeriod(t, db, fmt.Sprintf("Schuljahr-%d", testpkg.UniqueSuffix()),
		testpkg.NewCalendarDate(2030, time.April, 1), testpkg.NewCalendarDate(2030, time.June, 28))
	token := managerToken(t, account.ID)
	send := func(method, path string, body any, status int, into any) {
		t.Helper()
		response := testutil.ExecuteRequestForTest(t, router, testutil.NewAuthenticatedRequest(t, method, path, body, testutil.WithJWTBearer(token)))
		require.Equal(t, status, response.Code, response.Body.String())
		envelope := struct {
			Data any `json:"data"`
		}{Data: into}
		require.NoError(t, json.Unmarshal(response.Body.Bytes(), &envelope))
	}
	type shift struct {
		ID        string      `json:"id"`
		StaffID   json.Number `json:"staff_id"`
		Cancelled bool        `json:"cancelled"`
	}

	var created shift
	send(http.MethodPost, "/staff-shifts/", map[string]any{
		"staff_id": first.ID, "date": "2030-03-04", "start_time": "08:00", "end_time": "12:00", "break_minutes": 0,
	}, http.StatusCreated, &created)
	var moved shift
	send(http.MethodPut, "/staff-shifts/"+created.ID+"/move", map[string]any{
		"source_staff_id": first.ID, "target_staff_id": second.ID, "date": "2030-03-05",
		"start_time": "08:00", "end_time": "12:00", "break_minutes": 0, "shift_type_id": nil,
	}, http.StatusOK, &moved)
	assert.Equal(t, created.ID, moved.ID, "the move keeps the shift")
	assert.Equal(t, fmt.Sprint(second.ID), moved.StaffID.String())

	var cancellation struct {
		Shift        shift   `json:"shift"`
		Replacements []shift `json:"replacements"`
	}
	send(http.MethodPut, "/staff-shifts/"+created.ID+"/cancellation", map[string]any{
		"cancelled": true, "change_reason": "Fortbildung", "replacements": []any{},
	}, http.StatusOK, &cancellation)
	assert.True(t, cancellation.Shift.Cancelled)
	assert.Empty(t, cancellation.Replacements)

	var overview struct {
		Shifts []shift `json:"shifts"`
	}
	send(http.MethodGet, "/staff-shifts/overview?from=2030-03-04&to=2030-03-08", nil, http.StatusOK, &overview)
	assert.Contains(t, overview.Shifts, shift{ID: created.ID, StaffID: json.Number(fmt.Sprint(second.ID)), Cancelled: true})

	type series struct {
		SeriesID    string `json:"series_id"`
		OldSeriesID string `json:"old_series_id"`
		Created     int    `json:"created"`
	}
	var planned series
	send(http.MethodPost, "/staff-shifts/series", map[string]any{
		"staff_id": first.ID, "weekdays": []int{1}, "start_time": "08:00", "end_time": "12:00", "break_minutes": 0,
		"shift_type_id": nil, "calendar_period_id": period.ID, "week_pattern": 0, "valid_from": "2030-04-01", "valid_until": nil,
	}, http.StatusCreated, &planned)
	require.NotEmpty(t, planned.SeriesID)
	assert.Positive(t, planned.Created, "the series plans its Mondays")

	var split series
	send(http.MethodPut, "/staff-shifts/series/"+planned.SeriesID+"/split", map[string]any{
		"effective_date": "2030-05-06", "start_time": "09:00", "end_time": "12:00", "break_minutes": 0, "shift_type_id": nil,
	}, http.StatusOK, &split)
	assert.Equal(t, planned.SeriesID, split.OldSeriesID)
	assert.NotEqual(t, planned.SeriesID, split.SeriesID, "the change continues in a successor")
	var successorStart string
	require.NoError(t, db.NewRaw(`SELECT start_time::text FROM schedule.staff_shifts WHERE series_id = ? ORDER BY date LIMIT 1`, split.SeriesID).
		Scan(testpkg.Ctx(t), &successorStart))
	assert.Equal(t, "09:00:00", successorStart)
}
