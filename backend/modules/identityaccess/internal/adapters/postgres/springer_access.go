package postgres

import (
	"context"
	"fmt"
	"time"

	"github.com/uptrace/bun"
)

// The windowed access of a Springer (#7173, ADR 0249).

// EnsureWindowedAccountTenant maps the account to the school. A new or an
// inactive mapping becomes active and windowed; an active mapping keeps its
// mark, so unlimited access stays unlimited. The SET reads the old row.
func (s *Store) EnsureWindowedAccountTenant(ctx context.Context, accountID, tenantID int64) error {
	_, err := s.bindAccountToSchool(ctx, "ensure windowed account tenant", func(db bun.IDB) *bun.RawQuery {
		return db.NewRaw(refuseCatererAccount+`INSERT INTO auth.account_tenants AS mapping
				(account_id, tenant_id, status, activated_at, deactivated_at, access_windowed, created_at, updated_at)
			SELECT ?, ?, 'active', NOW(), NULL::timestamptz, true, NOW(), NOW() FROM caterer WHERE NOT caterer.refused
			ON CONFLICT (account_id, tenant_id) DO UPDATE
			SET access_windowed = mapping.access_windowed OR mapping.status <> 'active',
				activated_at = CASE WHEN mapping.status = 'active' THEN mapping.activated_at ELSE NOW() END,
				status = 'active', deactivated_at = NULL, updated_at = NOW()
			RETURNING 1`+reportCatererRefusal, accountID, accountID, tenantID)
	})
	return err
}

// SaveAccessWindow writes the window of a block on the account's mapping
// at the school, keyed by the block, and drops windows that have ended.
func (s *Store) SaveAccessWindow(ctx context.Context, accountID, tenantID, blockID int64, startsAt, endsAt time.Time) error {
	db, err := s.database(ctx)
	if err != nil {
		return err
	}
	_, err = db.NewRaw(`UPDATE auth.account_tenants AS mapping
		SET access_windows = COALESCE((SELECT jsonb_object_agg(slot.block_id, slot.span)
				FROM jsonb_each(mapping.access_windows) AS slot(block_id, span)
				WHERE (slot.span->>1)::timestamptz > now()), '{}'::jsonb)
			|| jsonb_build_object(?::text, jsonb_build_array(?::timestamptz, ?::timestamptz)),
			updated_at = NOW()
		WHERE mapping.account_id = ? AND mapping.tenant_id = ?`,
		blockID, startsAt, endsAt, accountID, tenantID).Exec(ctx)
	if err != nil {
		return fmt.Errorf("identity access postgres: save access window: %w", err)
	}
	return nil
}

// DeleteAccessWindow removes the window of a block from every mapping at
// the school; at most one holds it.
func (s *Store) DeleteAccessWindow(ctx context.Context, tenantID, blockID int64) error {
	db, err := s.database(ctx)
	if err != nil {
		return err
	}
	_, err = db.NewRaw(`UPDATE auth.account_tenants SET access_windows = access_windows - ?::text, updated_at = NOW()
		WHERE tenant_id = ? AND access_windows -> ?::text IS NOT NULL`, blockID, tenantID, blockID).Exec(ctx)
	if err != nil {
		return fmt.Errorf("identity access postgres: delete access window: %w", err)
	}
	return nil
}
