package http_test

import (
	"testing"
	"time"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// TestMain gives every test in this binary its own tenant (#2419), so parallel
// tests in the shared package clone cannot see or overwrite each other's rows.
func TestMain(m *testing.M) {
	testpkg.PerTestTenants()
	testpkg.Run(m)
}

// holidayTestToday is the day these suites decide on: a Monday before the
// booked week of 2030-07-08, so their closing days stay in the future on any
// real day (#7104).
func holidayTestToday() calendar.Date { return calendar.NewDate(2030, 6, 3) }

// holidayTestNow is noon of that day, the clock of the School Calendar.
func holidayTestNow() time.Time { return holidayTestToday().BerlinMidnight().Add(12 * time.Hour) }
