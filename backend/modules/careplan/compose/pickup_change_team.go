package compose

import (
	"time"

	"github.com/moto-ogs/project-phoenix/modules/careplan"
	"github.com/moto-ogs/project-phoenix/modules/careplan/internal/adapters/postgres"
	"github.com/moto-ogs/project-phoenix/modules/careplan/internal/application"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// NewPickupChangeTeam serves the notices of changed pickup times in the caller's school unit (ADR 0220).
func NewPickupChangeTeam(reach careplan.PickupChangeTeamReach, directory StudentDirectory, observe func(Observation), today func() calendar.Date, now func() time.Time) careplan.PickupChangeTeam {
	return application.NewPickupChangeTeam(postgres.NewPickupChangeTeamStore(postgres.New(postgres.AmbientCarePlanDatabase).WithClock(now), directory), reach, observe, today)
}
