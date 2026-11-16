// Package compose wires the Appointments module over the tenant UnitOfWork and Bun.
package compose

import (
	"context"
	"errors"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/appointments"
	"github.com/moto-ogs/project-phoenix/modules/appointments/internal/adapters/postgres"
	"github.com/moto-ogs/project-phoenix/modules/appointments/internal/application"
	"github.com/moto-ogs/project-phoenix/modules/appointments/internal/ports"
	"github.com/moto-ogs/project-phoenix/tenant"
	"github.com/uptrace/bun"
)

type Observation = ports.Observation
type Dependencies struct {
	DB      *bun.DB
	Observe func(Observation)
	Now     func() time.Time // stamps the revisions and dates the retention (ADR 0239)
}

// New composes the Appointments service, which is the whole Owner surface.
func New(dependencies Dependencies) (appointments.Owner, error) {
	if dependencies.DB == nil || dependencies.Observe == nil || dependencies.Now == nil {
		return nil, errors.New("appointments compose: all dependencies are required")
	}
	store := postgres.New(postgres.DatabaseBinding(dependencies.DB), dependencies.Now)
	return application.New(store, application.NewRetention(store, dependencies.Now), dependencies.Observe, withinTenant), nil
}

func withinTenant(ctx context.Context, command func(context.Context) error) error {
	return postgres.WithinTenantBinding(ctx, command, tenant.WithinTenant)
}
