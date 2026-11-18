package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/moto-ogs/project-phoenix/demoprofile"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestNeighbourDemoAttendanceFollowsBookedTimes(t *testing.T) {
	t.Parallel()
	type attendanceCall struct {
		Action string   `json:"action"`
		IDs    []string `json:"student_ids"`
	}
	var calls []attendanceCall
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/auth/login":
			_, _ = w.Write([]byte(`{"access_token":"neighbour-token"}`))
		case "/api/time-tracking/holidays", "/api/timetable/closing-days/", "/api/timetable/periods/":
			_, _ = w.Write([]byte(`{"data":[]}`))
		case "/api/students/school-checkin/batch":
			assert.Equal(t, "Bearer neighbour-token", r.Header.Get("Authorization"))
			var call attendanceCall
			assert.NoError(t, json.NewDecoder(r.Body).Decode(&call))
			calls = append(calls, call)
			results := make([]map[string]any, 0, len(call.IDs))
			for _, id := range call.IDs {
				// Child 2 was already checked in by the visitor.
				results = append(results, map[string]any{"student_id": id, "changed": id != "2"})
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"data": map[string]any{"results": results}})
		default:
			t.Errorf("unexpected request %s", r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()

	ticker := NewNeighbourAttendanceTicker(demoprofile.NeighbourAttendance{
		TenantSlug: "nachbarschule-demo",
		Admin:      demoprofile.BootstrapAdminCredentials{Email: "demo@example.test", Password: "seed-test"},
		Children: []demoprofile.NeighbourChild{
			{StudentID: 1, Weekdays: demoWeekdays[:4], Arrival: "12:30", Pickup: "14:00"},
			{StudentID: 2, Weekdays: demoWeekdays, Arrival: "12:30", Pickup: "16:30"},
			{StudentID: 3, Weekdays: demoWeekdays, Arrival: "12:30", Pickup: "16:30"},
		},
	}, newSeedTestAdapter(server.URL))
	thursday := calendar.NewDate(2026, time.November, 19).BerlinMidnight()
	check := func(now time.Time) { require.NoError(t, ticker.Tick(t.Context(), now.UTC())) }
	check(thursday.Add(12*time.Hour + 29*time.Minute))
	assert.Empty(t, calls)
	check(thursday.Add(12*time.Hour + 30*time.Minute))
	check(thursday.Add(13 * time.Hour))
	check(thursday.Add(14 * time.Hour))
	require.NoError(t, ticker.Close(t.Context(), thursday.Add(15*time.Hour)))
	check(thursday.AddDate(0, 0, 1).Add(13 * time.Hour))
	check(thursday.AddDate(0, 0, 1).Add(17 * time.Hour))
	check(thursday.AddDate(0, 0, 2).Add(13 * time.Hour))
	assert.Equal(t, []attendanceCall{
		{Action: "in", IDs: []string{"1", "2", "3"}},
		{Action: "out", IDs: []string{"1"}},
		{Action: "out", IDs: []string{"3"}},
		{Action: "in", IDs: []string{"2", "3"}},
		{Action: "out", IDs: []string{"3"}},
	}, calls)
}
