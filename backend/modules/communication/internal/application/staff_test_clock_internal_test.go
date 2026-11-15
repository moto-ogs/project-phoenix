package application

import (
	"time"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// staffTestNow is the fixed instant of the staff announcement tests, a
// Wednesday 10:00 in Berlin, so no deadline or expiry depends on the day the
// suite runs (#7104).
var staffTestNow = calendar.NewDate(2026, time.November, 18).BerlinMidnight().Add(10 * time.Hour)

func staffTestClock() time.Time { return staffTestNow }
