package ports

import (
	"context"
	"time"
)

// SpringerAccessStore keeps the access windows of a Springer (#7173,
// ADR 0249) in the caller's tenant transaction.
type SpringerAccessStore interface {
	EnsureSpringerAccountTenant(ctx context.Context, accountID, tenantID int64) error
	SaveAccessWindow(ctx context.Context, accountID, tenantID, blockID int64, startsAt, endsAt time.Time) error
	DeleteAccessWindow(ctx context.Context, tenantID, blockID int64) error
}
