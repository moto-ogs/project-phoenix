package postgres

import (
	"context"
	"time"

	"github.com/moto-ogs/project-phoenix/tenant"
	"github.com/uptrace/bun"
)

// NewStore resolves every statement against the caller's ambient
// transaction and reads the composition's clock.
func NewStore(db *bun.DB, now func() time.Time) *Store {
	scope := func(ctx context.Context) TenantScope {
		return ScopeFor(tenant.FromContext(ctx), tenant.IsAdminTx(ctx))
	}
	return New(func(ctx context.Context) (bun.IDB, error) {
		raw, ok := tenant.TransactionFromContext(ctx)
		return ResolveDatabase(raw, ok, scope(ctx))
	}, scope, now)
}
