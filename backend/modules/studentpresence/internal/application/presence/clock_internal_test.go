package presence

import (
	"time"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// presenceTestNow is the clock of the unit tests: the service reads no wall
// clock of its own (ADR 0276), so each test runs on Wednesday 2026-03-11 at
// 10:00 in Berlin.
func presenceTestNow() time.Time {
	return time.Date(2026, time.March, 11, 10, 0, 0, 0, calendar.Berlin)
}
