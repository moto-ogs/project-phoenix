package timetracking

import (
	"time"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// The time-tracking services read the clock of their composition (ADR 0239):
// NewClock binds the root's clock to every service, tests a fixed one. Only
// the roots and the compositions name the real clock (ADR 0272), so a
// service reached without its clock fails instead of reading the wall clock.

// requireClock is now; a service without the clock of its composition panics.
func requireClock(now func() time.Time) func() time.Time {
	if now == nil {
		panic("time tracking: the clock of the composition is required")
	}
	return now
}

// dayOf is today, or the Berlin calendar day of now when today is nil.
func dayOf(today func() calendar.Date, now func() time.Time) func() calendar.Date {
	if today == nil {
		return calendar.CalendarDateClock(requireClock(now))
	}
	return today
}
