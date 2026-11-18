package ports

import (
	"context"
	"time"
)

// SpringerAccessStore keeps the access windows of a Springer (#7173,
// ADR 0251) in the caller's tenant transaction.
type SpringerAccessStore interface {
	EnsureSpringerAccountTenant(ctx context.Context, accountID, tenantID int64) error
	SaveAccessWindow(ctx context.Context, accountID, tenantID, blockID int64, startsAt, endsAt time.Time) error
	DeleteAccessWindow(ctx context.Context, tenantID, blockID int64) error
	PruneAccessWindows(ctx context.Context, tenantID int64) error
	HoldsOnlySpringerRoles(ctx context.Context, accountID, tenantID int64, springerRole string) (bool, error)
}
