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
	// Keep the complete, idempotent tenant setup in one statement. The fixture
	// is deliberately called concurrently, and additional round trips consume
	// its five-second deadline. The CTEs preserve the organization → school →
	// setting dependency while accepting rows already present.
	if _, err := db.ExecContext(ctx, `
		WITH inserted_organization AS (
			INSERT INTO platform.organizations (id, name, slug, active)
			VALUES (?, ?, ?, true)
			ON CONFLICT DO NOTHING
			RETURNING id
		), organization_ids AS (
			SELECT id FROM inserted_organization
			UNION ALL
			SELECT id FROM platform.organizations WHERE id = ?
		), inserted_school AS (
			INSERT INTO platform.schools (id, organization_id, name, slug, subdomain, active)
			SELECT ?, id, ?, ?, ?, true FROM organization_ids
			ON CONFLICT DO NOTHING
			RETURNING id
		), school_ids AS (
			SELECT id FROM inserted_school
			UNION ALL
			SELECT id FROM platform.schools WHERE id = ?
		)
		INSERT INTO config.setting_values (tenant_id, setting_key, value)
		SELECT id, 'operations.federal_state', to_jsonb(?::text) FROM school_ids
		ON CONFLICT (tenant_id, setting_key) DO NOTHING`,
		tenantID, fmt.Sprintf("Test Org %d", tenantID), fmt.Sprintf("test-org-%d", tenantID), tenantID,
		tenantID, fmt.Sprintf("Test School %d", tenantID), fmt.Sprintf("test-school-%d", tenantID), fmt.Sprintf("t%d", tenantID), tenantID,
		TestSchoolFederalState); err != nil {
		return fmt.Errorf("ensure test tenant: %w", err)
	}

	return nil
}
