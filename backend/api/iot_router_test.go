package api

import (
	"context"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	iotcompose "github.com/moto-ogs/project-phoenix/api/iot/compose"

	"github.com/moto-ogs/project-phoenix/modules/devicefleet"
	feedbackModule "github.com/moto-ogs/project-phoenix/modules/feedback"
	"github.com/moto-ogs/project-phoenix/modules/peopledirectory"
	"github.com/moto-ogs/project-phoenix/modules/studentpresence"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type routerFeedback struct{}

// routerDeviceHistory satisfies the device history during route
// composition; the routes are never exercised here.
type routerDeviceHistory struct{}

func (routerDeviceHistory) RecordLifecycleEvent(context.Context, devicefleet.RecordLifecycleEvent) error {
	return nil
}

func (routerDeviceHistory) ListLifecycleEvents(context.Context, int64) ([]devicefleet.LifecycleEvent, error) {
	return nil, nil
}

// routerDeviceActors names no staff; route tests that read a history with
// names use the People Directory.
type routerDeviceActors struct{}

func (routerDeviceActors) ListPersonsByAccount(context.Context, []int64) ([]peopledirectory.Person, error) {
	return nil, nil
}

// mustDeviceHistory returns the history of a composed Device Fleet.
func mustDeviceHistory(t testing.TB, fleet devicefleet.Capability) devicefleet.LifecycleHistory {
	t.Helper()
	history, ok := fleet.(devicefleet.LifecycleHistory)
	require.True(t, ok, "the composed device fleet keeps the device history")
	return history
}

// routerRemovalSessions satisfies the device removal guard during route
// composition: no device runs an open session.
type routerRemovalSessions struct{}

func (routerRemovalSessions) QueryLiveGroups(context.Context, studentpresence.LiveGroupFilter) ([]studentpresence.LiveGroup, error) {
	return nil, nil
}

func (routerFeedback) Available(context.Context) (bool, error) { return true, nil }
func (routerFeedback) Submit(context.Context, feedbackModule.CreateEntry) (feedbackModule.Entry, error) {
	return feedbackModule.Entry{}, nil
}

// routerStaffClock satisfies the kiosk staff clock contract during route
// composition; the routes are never exercised here.
func newIoTRouterTestResource() *iotcompose.Resource {
	return &iotcompose.Resource{ServiceDependencies: iotcompose.ServiceDependencies{Runtime: NewIoTHTTPRuntime(time.Now), ErrorReports: NewIoTErrorReporter(nil, nil), Administration: NewIoTAdministration(nil, routerDeviceHistory{}, routerDeviceActors{}, routerRemovalSessions{}, slog.Default(), time.Now),
		DeviceScan:               routerDeviceScan{},
		StaffClock:               routerStaffClock{},
		FeedbackStudents:         routerDeviceScan{},
		FeedbackService:          routerFeedback{},
		FeedbackResponseObserver: func(int, string) {},
	}}
}

func TestIoTRouter_HasRoutes(t *testing.T) {
	t.Parallel()

	// Wire only the dependencies required during route composition.
	resource := newIoTRouterTestResource()

	router := resource.Router()

	// Verify router has routes registered by checking it responds
	// (routes will fail auth but router structure should be valid)
	require.NotNil(t, router)

	// Test that router can handle requests (even if they fail auth)
	req := httptest.NewRequest("GET", "/status", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	// We expect 401 Unauthorized since we have no device auth
	// This proves the route exists and middleware runs
	assert.NotEqual(t, http.StatusNotFound, w.Code)
}

func TestIoTRouter_CheckinRoute(t *testing.T) {
	t.Parallel()

	resource := newIoTRouterTestResource()
	router := resource.Router()

	req := httptest.NewRequest("POST", "/checkin", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	// Route exists (not 404)
	assert.NotEqual(t, http.StatusNotFound, w.Code)
}

func TestIoTRouter_PingRoute(t *testing.T) {
	t.Parallel()

	resource := newIoTRouterTestResource()
	router := resource.Router()

	req := httptest.NewRequest("POST", "/ping", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	// Route exists (not 404)
	assert.NotEqual(t, http.StatusNotFound, w.Code)
}

func TestIoTRouter_AttendanceRoute(t *testing.T) {
	t.Parallel()

	resource := newIoTRouterTestResource()
	router := resource.Router()

	req := httptest.NewRequest("GET", "/attendance/daily", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	// Route exists (not 404)
	assert.NotEqual(t, http.StatusNotFound, w.Code)
}

func TestIoTRouter_SessionRoute(t *testing.T) {
	t.Parallel()

	resource := newIoTRouterTestResource()
	router := resource.Router()

	req := httptest.NewRequest("POST", "/session/start", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	// Route exists (not 404)
	assert.NotEqual(t, http.StatusNotFound, w.Code)
}

func TestIoTRouter_FeedbackRoute(t *testing.T) {
	t.Parallel()

	resource := newIoTRouterTestResource()
	router := resource.Router()

	req := httptest.NewRequest("POST", "/feedback", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	// Route exists (not 404)
	assert.NotEqual(t, http.StatusNotFound, w.Code)
}

func TestIoTRouter_DataRoutes(t *testing.T) {
	t.Parallel()

	resource := newIoTRouterTestResource()
	router := resource.Router()

	tests := []struct {
		method string
		path   string
	}{
		{"GET", "/students"},
		{"GET", "/activities"},
		{"GET", "/rooms/available"},
		{"GET", "/rfid/test-tag"},
		{"GET", "/teachers"},
	}

	for _, tc := range tests {
		t.Run(tc.method+" "+tc.path, func(t *testing.T) {
			req := httptest.NewRequest(tc.method, tc.path, nil)
			w := httptest.NewRecorder()
			router.ServeHTTP(w, req)

			// Route exists (not 404)
			assert.NotEqual(t, http.StatusNotFound, w.Code)
		})
	}
}

func TestIoTRouter_StaffRFIDRoute(t *testing.T) {
	t.Parallel()

	resource := newIoTRouterTestResource()
	router := resource.Router()

	req := httptest.NewRequest("POST", "/staff/rfid/assign", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	// Route exists (not 404)
	assert.NotEqual(t, http.StatusNotFound, w.Code)
}

func TestIoTRouter_SchoolNameRoute(t *testing.T) {
	t.Parallel()

	resource := newIoTRouterTestResource()
	router := resource.Router()

	req := httptest.NewRequest("GET", "/school-name", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	// Route exists (not 404)
	assert.NotEqual(t, http.StatusNotFound, w.Code)
}
