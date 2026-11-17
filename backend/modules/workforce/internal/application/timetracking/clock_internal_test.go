package timetracking

import (
	"time"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// The unit tests of this package run on one fixed school day: TodayDate and
// testNow are the day and the clock they hand the services, which have no
// wall-clock fallback of their own (ADR 0276).
var testInstant = time.Date(2026, time.November, 11, 10, 0, 0, 0, calendar.Berlin)

func testNow() time.Time { return testInstant }

// TodayDate is the Berlin day of testNow.
func TodayDate() calendar.Date { return calendar.DateFromTime(testInstant) }
