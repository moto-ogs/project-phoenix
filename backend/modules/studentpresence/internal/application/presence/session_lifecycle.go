package presence

import (
	"time"

	"github.com/moto-ogs/project-phoenix/modules/studentpresence/internal/ports"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// Active-session lifecycle policy (Rule 12: Models Hold Data, Not Decisions).
//
// The active models (Group, Visit, GroupSupervisor, CombinedGroup) only hold
// their timestamp facts. Decisions built on those facts, such as "is this
// supervision still active right now?", live here with an injected clock.

// IsSupervisorActive decides whether a supervision assignment has started and
// has not ended as of now. A nil EndDate means open-ended after its StartDate.
func IsSupervisorActive(supervisor *ports.GroupSupervisor, now time.Time) bool {
	today := calendar.DateFromTime(now)
	return !supervisor.StartDate.After(today) &&
		(supervisor.EndDate == nil || today.Before(*supervisor.EndDate))
}
