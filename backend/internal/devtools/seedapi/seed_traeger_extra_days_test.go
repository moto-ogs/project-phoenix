package api

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// A seeded extra day is one Friday for each of its schools, with a
// registration window that is still open, and an included day has no price
// (#4817).
func TestSeedExtraDayIsOneFridayAheadForEachSchool(t *testing.T) {
	t.Parallel()
	for _, today := range []calendar.Date{calendar.NewDate(2026, 11, 26), calendar.NewDate(2026, 11, 27), calendar.NewDate(2026, 12, 31)} {
		date := seedExtraDayDate(today, 5)
		assert.Equal(t, time.Friday, date.Weekday())
		assert.True(t, date.AddDays(-7).After(today.AddDays(21)), "%s leaves the window open after %s", date, today)
	}
	day := seedExtraDay("Beweglicher Ferientag", calendar.NewDate(2026, 11, 27), calendar.NewDate(2027, 1, 8), true, 0, 31, 32)
	assert.Equal(t, "extra_day", day["kind"])
	assert.Equal(t, true, day["included_in_fee"])
	assert.Equal(t, "2027-01-01", day["registration_closes_on"])
	weeks := day["weeks"].([]map[string]any)
	assert.Len(t, weeks, 2)
	for _, week := range weeks {
		assert.Equal(t, "2027-01-08", week["starts_on"])
		assert.Equal(t, week["starts_on"], week["ends_on"])
		assert.Equal(t, 0, week["time_models"].([]map[string]any)[0]["price_cents"])
	}
}
