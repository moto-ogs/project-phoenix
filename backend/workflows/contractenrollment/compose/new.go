// Package compose binds the enrollment of the children of imported
// contracts (ADR 0309) to the tenant runtime; the root binds its owner
// ports.
package compose

import (
	"context"

	"github.com/moto-ogs/project-phoenix/tenant"
	"github.com/moto-ogs/project-phoenix/workflows/contractenrollment"
	"github.com/moto-ogs/project-phoenix/workflows/contractenrollment/internal/application"
	"github.com/moto-ogs/project-phoenix/workflows/contractenrollment/ports"
)

// New builds the workflow over the owner ports; it opens the Träger
// transaction and the school's tenant transaction itself, never nested.
func New(deps ports.Dependencies) (contractenrollment.Enrollments, error) {
	deps.Runtime = runtime{}
	return application.New(deps)
}

type runtime struct{}

func (runtime) WithinTraeger(ctx context.Context, organizationID int64, fn func(context.Context) error) error {
	return tenant.WithinTraeger(ctx, organizationID, fn)
}

func (runtime) WithinSchool(ctx context.Context, schoolID int64, fn func(context.Context) error) error {
	id, err := tenant.NewTenantID(schoolID)
	if err != nil {
		return err
	}
	return tenant.WithinTenant(ctx, id, fn)
}
