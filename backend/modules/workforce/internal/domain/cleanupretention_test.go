package domain

import (
	"testing"
	"time"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/stretchr/testify/assert"
)

// At noon on the day of a Berlin clock change the cutoff is 30 times 24
// hours back, an hour off noon 30 calendar days back, which the database
// guard would refuse after the spring change.
func TestFinishedFileCleanupCutoffCountsElapsedDaysAcrossDST(t *testing.T) {
	t.Parallel()
	for _, now := range []time.Time{
		time.Date(2026, time.March, 29, 12, 0, 0, 0, calendar.Berlin),
		time.Date(2026, time.October, 25, 12, 0, 0, 0, calendar.Berlin),
	} {
		cutoff := FinishedFileCleanupCutoff(now, CleanupRetentionWindow)

		assert.Equal(t, 30*24*time.Hour, now.Sub(cutoff), "at %s", now)
		assert.False(t, cutoff.Equal(now.AddDate(0, 0, -30)), "at %s the window spans a clock change", now)
	}
}
