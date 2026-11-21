package httpadapter_test

import (
	"net/http"
	"testing"

	"github.com/go-chi/chi/v5"
	httpadapter "github.com/moto-ogs/project-phoenix/modules/timetable/http/activities"
	"github.com/stretchr/testify/require"
)

// Schedules are written and read through the activity itself; no route of
// their own is exposed, neither a read nor a write.
func TestActivityScheduleRoutesAreNotExposed(t *testing.T) {
	t.Parallel()
	resource := &httpadapter.Resource{}
	router := resource.Router(func(r chi.Router, mount func(chi.Router, func(http.Handler) http.Handler)) {
		mount(r, func(next http.Handler) http.Handler { return next })
	})
	routes := make(map[string]bool)
	require.NoError(t, chi.Walk(router, func(method, route string, _ http.Handler, _ ...func(http.Handler) http.Handler) error {
		routes[method+" "+route] = true
		return nil
	}))
	require.True(t, routes["GET /{id}"], "the activity read must stay mounted")
	const byID = "/{id}/schedules/{scheduleId}"
	for _, route := range []string{
		"GET /{id}/schedules", "POST /{id}/schedules", "GET " + byID, "PUT " + byID,
		"DELETE " + byID, "GET /schedules/available",
	} {
		t.Run(route, func(t *testing.T) {
			require.False(t, routes[route], "schedule endpoint must not be exposed: %s", route)
		})
	}
}
