package api

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// The Winterferien booked by days lie on a Monday-to-Friday week whose
// registration window is still open for more than a week (#4701).
func TestSeedHolidayDayPeriodLiesAheadOfItsRegistration(t *testing.T) {
	t.Parallel()
	for _, today := range []calendar.Date{calendar.NewDate(2026, 11, 10), calendar.NewDate(2027, 1, 30), calendar.NewDate(2027, 2, 3)} {
		monday := seedNextWinterMonday(today)
		assert.Equal(t, time.Monday, monday.Weekday())
		assert.Equal(t, time.February, monday.Month())
		assert.True(t, monday.AddDays(-3).After(today.AddDays(7)), "%s leaves the window open after %s", monday, today)
	}
	period := seedHolidayDayPeriod(calendar.NewDate(2026, 11, 10), calendar.NewDate(2027, 2, 1), 31)
	assert.Equal(t, 3, period["max_days_per_child"])
	week := period["weeks"].([]map[string]any)[0]
	assert.Equal(t, "day", week["booking_unit"])
	assert.Equal(t, "2027-02-05", week["ends_on"])
}

// The Winterferien by criteria lie a week after those booked by days, with
// their registration window still open, and give no place when sending
// (#4700).
func TestSeedHolidayCriteriaPeriodAllocatesByCriteria(t *testing.T) {
	t.Parallel()
	today := calendar.NewDate(2026, 11, 10)
	monday := seedNextWinterMonday(today).AddDays(7)
	period := seedHolidayCriteriaPeriod(today, monday, 31)
	assert.Equal(t, "criteria", period["allocation_mode"])
	week := period["weeks"].([]map[string]any)[0]
	assert.Equal(t, "2027-02-08", week["starts_on"])
	assert.True(t, monday.AddDays(-10).After(today))
}

// Seed the criteria through the versioned catalog endpoint without changing
// the priority proposal that the subsequent demo steps expect.
func TestSeedHolidayCriteriaWritesPriorityAndDemoWeights(t *testing.T) {
	t.Parallel()
	srv := newSeedHTTPTestServer(func(w seedHTTPResponseWriter, r *seedHTTPRequest) {
		assert.Equal(t, "/traeger/holiday-periods/criteria", r.URL.Path)
		w.Header().Set("Content-Type", "application/json")
		if r.Method == seedHTTPMethodGet {
			_, _ = w.Write([]byte(`{"status":"success","data":{"version":"catalog-version"}}`))
			return
		}
		assert.Equal(t, seedHTTPMethodPut, r.Method)
		var body struct {
			Version  string `json:"expected_version"`
			Ranking  string `json:"ranking"`
			Criteria []struct {
				Points int `json:"points"`
			} `json:"criteria"`
		}
		if !assert.NoError(t, json.NewDecoder(r.Body).Decode(&body)) {
			w.WriteHeader(400)
			return
		}
		assert.Equal(t, "catalog-version", body.Version)
		assert.Equal(t, "priority", body.Ranking)
		var weights []int
		for _, criterion := range body.Criteria {
			weights = append(weights, criterion.Points)
		}
		assert.Equal(t, []int{3, 2, 1, 2}, weights)
		_, _ = w.Write([]byte(`{"status":"success","data":{"criteria":[{"id":"2"},{"id":"3"},{"id":"4"},{"id":"5"}]}}`))
	})
	defer srv.Close()
	rt := &Runtime{Client: newTestClient(srv.URL, false)}
	_, err := seedHolidayCriteria(rt, AuthRef{Kind: AuthBearer, Token: "traeger-token"})
	require.NoError(t, err)
}
