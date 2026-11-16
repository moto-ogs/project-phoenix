package compose_test

import (
	"testing"
	"time"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// presenceToday is the school day, a Monday, the clock-dependent tests of
// this package run on; presenceClock is the module clock at 10:00 Berlin.
var presenceToday = calendar.NewDate(2026, 11, 2)

func presenceClock() time.Time { return presenceToday.BerlinMidnight().Add(10 * time.Hour) }

func TestMain(m *testing.M) {
	testpkg.PerTestTenants()
	testpkg.Run(m)
}
