package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"slices"
	"sync"
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
	var mu sync.Mutex
	var calls []attendanceCall
	var owned []string
	var staffOnDuty, staffEnded bool
	var staffCheckins, staffCheckouts int
	var stampedDay calendar.Date
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		switch r.URL.Path {
		case "/auth/login":
			_, _ = w.Write([]byte(`{"access_token":"neighbour-token"}`))
		case "/api/time-tracking/holidays", "/api/timetable/closing-days/", "/api/timetable/periods/":
			_, _ = w.Write([]byte(`{"data":[]}`))
		case "/api/time-tracking/current":
			if staffOnDuty {
				_, _ = w.Write([]byte(`{"data":{"id":"17"}}`))
			} else {
				_, _ = w.Write([]byte(`{"data":null}`))
			}
		case "/api/time-tracking/check-out":
			assert.True(t, staffOnDuty)
			staffOnDuty = false
			staffEnded = true
			staffCheckouts++
			_, _ = w.Write([]byte(`{"data":{}}`))
		case "/api/time-tracking/check-in":
			assert.False(t, staffOnDuty)
			staffOnDuty = true
			staffCheckins++
			_, _ = w.Write([]byte(`{"data":{}}`))
		case "/api/students/school-checkin/batch":
			assert.Equal(t, "Bearer neighbour-token", r.Header.Get("Authorization"))
			var call attendanceCall
			assert.NoError(t, json.NewDecoder(r.Body).Decode(&call))
			calls = append(calls, call)
			if !staffEnded {
				staffOnDuty = true
			}
			results := make([]map[string]any, 0, len(call.IDs))
			for _, id := range call.IDs {
				// Child 2 was already checked in by the visitor.
				changed := id != "2"
				if call.Action == "out" {
					assert.Contains(t, owned, id)
					owned = slices.DeleteFunc(owned, func(open string) bool { return open == id })
				} else if changed {
					assert.NotContains(t, owned, id)
					owned = append(owned, id)
				}
				results = append(results, map[string]any{"student_id": id, "changed": changed})
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"data": map[string]any{"results": results}})
		default:
			t.Errorf("unexpected request %s", r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()

	school := demoprofile.NeighbourAttendance{
		TenantSlug: "nachbarschule-demo",
		Admin:      demoprofile.BootstrapAdminCredentials{Email: "demo@example.test", Password: "seed-test"},
		Children: []demoprofile.NeighbourChild{
			{StudentID: 1, Weekdays: demoWeekdays[:4], Arrival: "12:30", Pickup: "14:00"},
			{StudentID: 2, Weekdays: demoWeekdays, Arrival: "12:30", Pickup: "16:30"},
			{StudentID: 3, Weekdays: demoWeekdays, Arrival: "12:30", Pickup: "16:30"},
		},
	}
	newTicker := func() *NeighbourAttendanceTicker {
		return NewNeighbourAttendanceTicker(school, newSeedTestAdapter(server.URL), func(_ context.Context, day calendar.Date) ([]string, error) {
			mu.Lock()
			defer mu.Unlock()
			if day != stampedDay {
				stampedDay = day
				staffEnded = false
			}
			return slices.Clone(owned), nil
		})
	}
	ticker := newTicker()
	thursday := calendar.NewDate(2026, time.November, 19).BerlinMidnight()
	check := func(now time.Time) { require.NoError(t, ticker.Tick(t.Context(), now.UTC())) }
	check(thursday.Add(12*time.Hour + 29*time.Minute))
	mu.Lock()
	assert.Empty(t, calls)
	mu.Unlock()
	check(thursday.Add(12*time.Hour + 30*time.Minute))
	check(thursday.Add(13 * time.Hour))
	// A new worker recovers previously opened stays and settles pickup time.
	ticker = newTicker()
	check(thursday.Add(14 * time.Hour))
	require.NoError(t, ticker.Close(t.Context(), thursday.Add(15*time.Hour)))
	ticker = newTicker()
	check(thursday.Add(15*time.Hour + time.Minute))
	mu.Lock()
	assert.True(t, staffOnDuty, "returning on the same day opens a new work block")
	assert.Equal(t, 1, staffCheckins)
	mu.Unlock()
	check(thursday.Add(17 * time.Hour))
	check(thursday.AddDate(0, 0, 1).Add(13 * time.Hour))
	check(thursday.AddDate(0, 0, 1).Add(17 * time.Hour))
	check(thursday.AddDate(0, 0, 2).Add(13 * time.Hour))
	mu.Lock()
	defer mu.Unlock()
	assert.False(t, staffOnDuty)
	assert.Equal(t, 3, staffCheckouts)
	assert.Equal(t, []attendanceCall{
		{Action: "in", IDs: []string{"1", "2", "3"}},
		{Action: "out", IDs: []string{"1"}},
		{Action: "in", IDs: []string{"2"}}, // Idempotent: the visitor's stay is still open.
		{Action: "out", IDs: []string{"3"}},
		{Action: "in", IDs: []string{"2", "3"}},
		{Action: "out", IDs: []string{"3"}},
		{Action: "in", IDs: []string{"2", "3"}},
		{Action: "out", IDs: []string{"3"}},
	}, calls)
}
