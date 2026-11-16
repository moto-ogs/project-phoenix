package owners

import (
	"context"
	"fmt"
	"log/slog"
	"testing"
	"time"

	deliveryCompose "github.com/moto-ogs/project-phoenix/modules/delivery/compose"
	observabilityCompose "github.com/moto-ogs/project-phoenix/observability/compose"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

type pwaUsageNoGuardianSchools struct{}

func (pwaUsageNoGuardianSchools) ListGuardianSchoolIDs(context.Context, int64) ([]int64, error) {
	return nil, nil
}

type pwaUsageNoCounts struct{}

func (pwaUsageNoCounts) PWAUsage(context.Context, int64, time.Duration) ([]deliveryCompose.PWAUsageRow, error) {
	return nil, nil
}

type pwaUsageRetentionDays int

func (d pwaUsageRetentionDays) ResolveInt(context.Context, string) (int, error) { return int(d), nil }

// TestPWAUsageReportAndRetentionShareTheRootClock wires the usage service the
// way BuildDeliveryDevices does, over the real usage store, with the root's
// clock pinned years away from the database's. The service stamps
// last_seen_at and dates the retention cutoff on that one clock (ADR 0277):
// a report made at the pinned instant is fresh, and only a report older than
// the window by that clock goes.
func TestPWAUsageReportAndRetentionShareTheRootClock(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	tenantID := testpkg.Tenant(t)
	account := testpkg.CreateTestAccount(t, db, fmt.Sprintf("pwa-clock-%d@example.com", testpkg.UniqueSuffix()))
	testpkg.EnsureAccountTenant(t, db, account.ID, tenantID)
	pinned := time.Date(2031, time.June, 2, 12, 0, 0, 0, time.UTC)
	usage, err := deliveryCompose.NewTenantPWAUsageService(testpkg.TenantRuntime(t, db), db,
		observabilityCompose.NewPWAStandaloneUsageRepository(db), pwaUsageNoCounts{}, pwaUsageNoGuardianSchools{},
		pwaUsageRetentionDays(30), slog.Default(), func() time.Time { return pinned })
	require.NoError(t, err)
	inTenant := func(call func(context.Context) error) error {
		return testpkg.WithTenantTx(t, context.Background(), db, tenantID, func(txCtx context.Context, _ bun.Tx) error {
			return call(txCtx)
		})
	}
	cleanup := func() (deleted int, cutoff time.Time) {
		require.NoError(t, inTenant(func(ctx context.Context) error {
			result, cleanupErr := usage.CleanupExpiredUsage(ctx)
			if cleanupErr == nil {
				deleted, cutoff = result.RowsDeleted, result.Cutoff
			}
			return cleanupErr
		}))
		return deleted, cutoff
	}

	require.NoError(t, inTenant(func(ctx context.Context) error { return usage.ReportStaff(ctx, account.ID) }))
	var lastSeen time.Time
	require.NoError(t, db.NewRaw(`SELECT last_seen_at FROM iot.pwa_standalone_usage WHERE tenant_id = ? AND account_id = ?`,
		tenantID, account.ID).Scan(context.Background(), &lastSeen))
	assert.True(t, pinned.Equal(lastSeen), "the root's clock stamps the report, got %s", lastSeen)

	deleted, cutoff := cleanup()
	assert.Zero(t, deleted, "a report made at the root's instant is inside the window")
	assert.True(t, pinned.AddDate(0, 0, -30).Equal(cutoff))

	_, err = db.ExecContext(context.Background(), `UPDATE iot.pwa_standalone_usage SET last_seen_at = ?
		WHERE tenant_id = ? AND account_id = ?`, pinned.AddDate(0, 0, -31), tenantID, account.ID)
	require.NoError(t, err)
	deleted, _ = cleanup()
	assert.Equal(t, 1, deleted, "a report 31 days old by the root's clock has aged out")
}
