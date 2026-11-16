package timetracking

import (
	"time"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// The time-tracking services read the clock of their composition (ADR 0239):
// NewClock binds the root's clock to every service, tests a fixed one. A
// service a unit test builds bare without a clock reads the wall clock.

// clockOrWall is now, or the wall clock when now is nil.
func clockOrWall(now func() time.Time) func() time.Time {
	if now == nil {
		return time.Now
	}
	return now
}

// dayOrWall is today, or the Berlin calendar day of now when today is nil.
func dayOrWall(today func() calendar.Date, now func() time.Time) func() calendar.Date {
	if today == nil {
		return calendar.CalendarDateClock(now)
	}
	return today
}
