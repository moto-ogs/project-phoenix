package application

import (
	"time"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// enrollmentTestDay is the school day the unit tests of the application pin
// their clock to (#7104): a Monday, so no test depends on the real day.
var enrollmentTestDay = calendar.NewDate(2026, time.November, 16)

// enrollmentTestClock is the instant of enrollmentTestDay the services read.
func enrollmentTestClock() time.Time { return enrollmentTestDay.BerlinMidnight().Add(10 * time.Hour) }

// enrollmentTestToday is the day clock of enrollmentTestClock.
func enrollmentTestToday() calendar.Date { return enrollmentTestDay }
