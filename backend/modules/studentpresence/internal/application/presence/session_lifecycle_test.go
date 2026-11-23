package presence

import (
	"testing"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/studentpresence/internal/ports"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/stretchr/testify/assert"
)

// These unit tests cover the supervision lifecycle policy that moved off the
// models (Rule 12). The clock is injected as `now` everywhere, so the tests are
// deterministic and need no DB or sleeps.

func ptrDate(d calendar.Date) *calendar.Date { return &d }

func TestIsSupervisorActive(t *testing.T) {
	t.Parallel()

	now := time.Date(2024, 1, 1, 12, 0, 0, 0, time.UTC)

	assert.True(t, IsSupervisorActive(&ports.GroupSupervisor{StartDate: calendar.DateFromTime(now), EndDate: nil}, now),
		"nil end date is open-ended and active")
	assert.True(t, IsSupervisorActive(&ports.GroupSupervisor{StartDate: calendar.DateFromTime(now), EndDate: ptrDate(calendar.DateFromTime(now).AddDays(1))}, now),
		"future end date is still active")
	assert.False(t, IsSupervisorActive(&ports.GroupSupervisor{StartDate: calendar.DateFromTime(now).AddDays(-2), EndDate: ptrDate(calendar.DateFromTime(now).AddDays(-1))}, now),
		"past end date is not active")
	assert.False(t, IsSupervisorActive(&ports.GroupSupervisor{StartDate: calendar.DateFromTime(now).AddDays(1)}, now),
		"future start date is not active")
}
