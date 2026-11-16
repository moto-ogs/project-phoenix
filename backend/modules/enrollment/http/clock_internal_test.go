package enrollmenthttp

import (
	"time"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// resourceTestClock is the fixed clock the route unit tests give a bare
// Resource (#7104): a Monday school day, so no test reads the real day.
func resourceTestClock() time.Time {
	return calendar.NewDate(2026, time.November, 16).BerlinMidnight().Add(10 * time.Hour)
}
