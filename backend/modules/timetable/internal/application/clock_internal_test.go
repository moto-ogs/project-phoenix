package application

import (
	"time"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// internalTestNow pins the clock of the services these unit tests build
// directly to the day they last ran on the wall clock, a Monday morning.
func internalTestNow() time.Time {
	return time.Date(2026, time.November, 16, 10, 0, 0, 0, calendar.Berlin)
}
