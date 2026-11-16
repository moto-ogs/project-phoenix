package compose

import (
	"errors"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/organizationtenancy"
	"github.com/moto-ogs/project-phoenix/modules/organizationtenancy/internal/adapters/postgres"
	"github.com/moto-ogs/project-phoenix/modules/organizationtenancy/internal/application"
	"github.com/moto-ogs/project-phoenix/modules/organizationtenancy/internal/ports"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/uptrace/bun"
)

type Observation = ports.Observation

type Dependencies struct {
	DB      *bun.DB
	Observe func(Observation)
	Now     func() time.Time // the root's clock; nil is the real one
}

func New(dependencies Dependencies) (organizationtenancy.Capability, error) {
	if dependencies.DB == nil || dependencies.Observe == nil {
		return nil, errors.New("organization tenancy compose: all dependencies are required")
	}
	store := postgres.New(postgres.NewDatabase())
	return application.New(store, postgres.Transaction{}, dependencies.Observe, calendar.CalendarDateClock(dependencies.Now)), nil
}
