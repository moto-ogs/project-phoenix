package postgres

import (
	"context"
	"fmt"
	"time"

	"github.com/uptrace/bun"

	"github.com/moto-ogs/project-phoenix/modules/identityaccess/internal/domain"
)

// The access windows of a Springer (#7173, ADR 0251).

// EnsureSpringerAccountTenant maps the account to the school. A new or an
// inactive mapping becomes active; an active mapping keeps its activation,
// so the account's default school stays where it was.
func (s *Store) EnsureSpringerAccountTenant(ctx context.Context, accountID, tenantID int64) error {
	_, err := s.bindAccountToSchool(ctx, "ensure springer account tenant", func(db bun.IDB) *bun.RawQuery {
		return db.NewRaw(refuseCatererAccount+`INSERT INTO auth.account_tenants AS mapping
				(account_id, tenant_id, status, activated_at, deactivated_at, created_at, updated_at)
			SELECT ?, ?, 'active', NOW(), NULL::timestamptz, NOW(), NOW() FROM caterer WHERE NOT caterer.refused
			ON CONFLICT (account_id, tenant_id) DO UPDATE
			SET activated_at = CASE WHEN mapping.status = 'active' THEN mapping.activated_at ELSE NOW() END,
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

// PruneAccessWindows drops the windows that have ended from every mapping
// at the school; a mapping without one stays untouched.
func (s *Store) PruneAccessWindows(ctx context.Context, tenantID int64) error {
	db, err := s.database(ctx)
	if err != nil {
		return err
	}
	_, err = db.NewRaw(`UPDATE auth.account_tenants AS mapping
		SET access_windows = COALESCE((SELECT jsonb_object_agg(slot.block_id, slot.span)
				FROM jsonb_each(mapping.access_windows) AS slot(block_id, span)
				WHERE (slot.span->>1)::timestamptz > now()), '{}'::jsonb),
			updated_at = NOW()
		WHERE mapping.tenant_id = ? AND mapping.access_windows <> '{}'::jsonb
		  AND EXISTS (SELECT FROM jsonb_each(mapping.access_windows) AS slot(block_id, span)
			WHERE (slot.span->>1)::timestamptz <= now())`, tenantID).Exec(ctx)
	if err != nil {
		return fmt.Errorf("identity access postgres: prune access windows: %w", err)
	}
	return nil
}

// HoldsOnlySpringerRoles reports whether the account holds the system role
// springerRole at the school and no role there but it and guardian.
func (s *Store) HoldsOnlySpringerRoles(ctx context.Context, accountID, tenantID int64, springerRole string) (bool, error) {
	db, err := s.database(ctx)
	if err != nil {
		return false, err
	}
	var only bool
	err = db.NewRaw(`SELECT COALESCE(bool_or(role.tenant_id IS NULL AND role.name = ?)
			AND bool_and(role.tenant_id IS NULL AND role.name IN (?, ?)), false)
		FROM auth.account_roles AS held JOIN auth.roles AS role ON role.id = held.role_id
		WHERE held.account_id = ? AND held.tenant_id = ?`,
		springerRole, springerRole, domain.GuardianRoleName, accountID, tenantID).Scan(ctx, &only)
	if err != nil {
		return false, fmt.Errorf("identity access postgres: read springer roles: %w", err)
	}
	return only, nil
}
