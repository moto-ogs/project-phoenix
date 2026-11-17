package domain

import (
	"time"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// journalClockMargin reads the year a little earlier, so a cutoff computed
// right at New Year is never refused by the database's own later reading.
const journalClockMargin = time.Minute

// JournalRetentionCutoff is the first instant the journal keeps (#4044): an
// attempt stays until the end of the year after it, so everything before
// 1 January of last year (Berlin) goes. Migration 1.15.454 enforces the
// same window in the database.
func JournalRetentionCutoff(now time.Time) time.Time {
	year := now.In(calendar.Berlin).Add(-journalClockMargin).Year()
	return time.Date(year-1, time.January, 1, 0, 0, 0, 0, calendar.Berlin)
}
