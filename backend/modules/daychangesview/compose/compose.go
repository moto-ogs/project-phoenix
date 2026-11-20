// Package compose builds the projection "Heute anders" (ADR 0299) for the
// root, which binds its source ports. Each source runs in its own savepoint
// of the request's school transaction.
package compose

import (
	"context"

	"github.com/moto-ogs/project-phoenix/modules/daychangesview"
	"github.com/moto-ogs/project-phoenix/tenant"
)

// New builds the projection over the request transaction's savepoints.
func New(deps daychangesview.Dependencies) (daychangesview.Query, error) {
	deps.Isolation = savepoints{}
	return daychangesview.New(deps)
}

// savepoints isolates every source in a savepoint, so a failed statement of
// one source leaves the transaction usable for the next (ADR 0299 point 7).
type savepoints struct{}

func (savepoints) Run(ctx context.Context, read func(context.Context) error) error {
	return tenant.WithSavepoint(ctx, read)
}

func (savepoints) IsFatal(err error) bool { return tenant.IsSavepointControlFailure(err) }
