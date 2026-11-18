package test

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

// EnsureTestTenant creates the platform.organizations and platform.schools
// rows required by the FK constraint on tenant_id. Uses ON CONFLICT DO NOTHING
// so it's safe to call multiple times with the same ID.
func EnsureTestTenant(tb testing.TB, db *bun.DB, tenantID int64) {
	tb.Helper()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	require.NoError(tb, ensureTestTenant(ctx, db, tenantID), "Failed to ensure test tenant")
}

// ensureTestTenant is the error-returning core of EnsureTestTenant, shared
// with the process-once clone bootstrap in db_clone.go.
func ensureTestTenant(ctx context.Context, db *bun.DB, tenantID int64) error {
	// Each upsert needs its own statement snapshot. A concurrent organization
	// insert that is not visible when a CTE begins is invisible after ON
	// CONFLICT DO NOTHING too, so the dependent school and setting inserts would
	// otherwise silently receive no input rows.
	if _, err := db.ExecContext(ctx, `
		INSERT INTO platform.organizations (id, name, slug, active)
		VALUES (?, ?, ?, true)
		ON CONFLICT DO NOTHING`,
		tenantID, fmt.Sprintf("Test Org %d", tenantID), fmt.Sprintf("test-org-%d", tenantID)); err != nil {
		return fmt.Errorf("ensure test organization: %w", err)
	}
	if _, err := db.ExecContext(ctx, `
		INSERT INTO platform.schools (id, organization_id, name, slug, subdomain, active)
		VALUES (?, ?, ?, ?, ?, true)
		ON CONFLICT DO NOTHING`,
		tenantID, tenantID, fmt.Sprintf("Test School %d", tenantID), fmt.Sprintf("test-school-%d", tenantID), fmt.Sprintf("t%d", tenantID)); err != nil {
		return fmt.Errorf("ensure test school: %w", err)
	}
	if _, err := db.ExecContext(ctx, `
		INSERT INTO config.setting_values (tenant_id, setting_key, value)
		VALUES (?, 'operations.federal_state', to_jsonb(?::text))
		ON CONFLICT (tenant_id, setting_key) DO NOTHING`, tenantID, TestSchoolFederalState); err != nil {
		return fmt.Errorf("ensure test tenant federal state: %w", err)
	}

	return nil
}
