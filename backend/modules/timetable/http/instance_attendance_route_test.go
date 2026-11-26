package timetablehttp_test

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	rootAPI "github.com/moto-ogs/project-phoenix/api"
	apiTest "github.com/moto-ogs/project-phoenix/api/testutil"
	"github.com/moto-ogs/project-phoenix/auth/authorize/permissions"
	"github.com/moto-ogs/project-phoenix/modules/timetable"
	timetableAPI "github.com/moto-ogs/project-phoenix/modules/timetable/http"
	"github.com/moto-ogs/project-phoenix/roots/owners"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/require"
)

func TestInstanceAttendanceReadScope(t *testing.T) {
	t.Parallel()
	db, module, _ := setupTimetableModule(t)
	settings, err := owners.NewSettingsTestModule(testpkg.NewDatabase(t, db), testpkg.TenantRuntime(t, db))
	require.NoError(t, err)
	now := time.Date(2027, 1, 11, 10, 0, 0, 0, calendar.Berlin)
	resource := timetableAPI.NewResource(timetableAPI.Dependencies{
		TimetableData: module.TimetableData.Data, SettingsService: settings.Settings, Now: func() time.Time { return now },
	})
	router := chi.NewRouter()
	router.Mount("/api/timetable", resource.Router(rootAPI.ProtectedTenantRoutes))
	room := testpkg.CreateTestRoom(t, db, "Attendance")
	date := calendar.NewDate(2027, 1, 11)
	selected := testpkg.CreateTestActivityInstance(t, db, date, room.ID, testpkg.ActivityInstanceOpts{})
	other := testpkg.CreateTestActivityInstance(t, db, date, room.ID, testpkg.ActivityInstanceOpts{})
	anna := testpkg.CreateTestStudent(t, db, "Anna", "Selected", "1a")
	ben := testpkg.CreateTestStudent(t, db, "Ben", "Other", "1a")
	testpkg.CreateTestInstanceStudent(t, db, selected.ID, anna.ID, timetable.SlotAttendanceExpected)
	testpkg.CreateTestInstanceStudent(t, db, other.ID, ben.ID, timetable.SlotAttendancePresent)

	account := testpkg.CreateTestAccount(t, db, "attendance-reader")
	request := func(method, path string, tenantID int64, grants ...string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, "/api/timetable/instances/"+path, nil)
		return apiTest.ExecuteWithAuth(t, router, req, apiTest.TenantUserTestClaims(int(account.ID), tenantID, grants...))
	}
	tenantID := testpkg.Tenant(t)
	read := fmt.Sprintf("%d/attendance", selected.ID)
	for _, grants := range [][]string{{permissions.SchedulesRead}, {permissions.SchedulesRead, permissions.SchedulesManage}} {
		got := request(http.MethodGet, read, tenantID, grants...)
		require.Equal(t, http.StatusOK, got.Code, got.Body.String())
		var envelope struct {
			Data struct {
				InstanceID string           `json:"instance_id"`
				Students   []map[string]any `json:"students"`
			} `json:"data"`
		}
		require.NoError(t, json.Unmarshal(got.Body.Bytes(), &envelope))
		require.Equal(t, fmt.Sprint(selected.ID), envelope.Data.InstanceID)
		require.Len(t, envelope.Data.Students, 1)
		require.Equal(t, map[string]any{"student_id": fmt.Sprint(anna.ID), "status": "expected", "care_day_status": "unknown"}, envelope.Data.Students[0])
	}
	foreign := testpkg.NewTenantScope(t, db)
	require.Equal(t, http.StatusNotFound, request(http.MethodGet, read, foreign.TenantID, permissions.SchedulesRead).Code)
	require.Equal(t, http.StatusForbidden, request(http.MethodGet, read, tenantID, permissions.UsersRead).Code)
	require.Equal(t, http.StatusForbidden, request(http.MethodPatch, fmt.Sprintf("%d/students/%d", selected.ID, anna.ID), tenantID, permissions.SchedulesRead).Code)
}
