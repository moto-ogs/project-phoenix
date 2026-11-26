// Package compose binds the caterer portal workflow to Identity & Access, the
// Meal Plan and the tenant runtime.
package compose

import (
	"context"

	"github.com/moto-ogs/project-phoenix/tenant"
	"github.com/moto-ogs/project-phoenix/workflows/catererportal"
	"github.com/moto-ogs/project-phoenix/workflows/catererportal/internal/application"
	"github.com/moto-ogs/project-phoenix/workflows/catererportal/ports"
)

// New binds the portal; each school runs in its own tenant transaction.
func New(caterers ports.Caterers, orders ports.MealOrders, summary ports.OrderSummary, schoolNames ports.SchoolNames) (catererportal.Portal, error) {
	return application.New(application.Dependencies{
		Caterers:      caterers,
		Orders:        orders,
		Summary:       summary,
		SchoolNames:   schoolNames,
		CurrentSchool: tenant.FromContext,
		Lock:          func(ctx context.Context, key string) error { return tenant.AcquireLock(ctx, key, false) },
		WithinSchool: func(ctx context.Context, schoolID int64, fn func(context.Context) error) error {
			id, err := tenant.NewTenantID(schoolID)
			if err != nil {
				return err
			}
			return tenant.WithinTenant(ctx, id, fn)
		},
	})
}
