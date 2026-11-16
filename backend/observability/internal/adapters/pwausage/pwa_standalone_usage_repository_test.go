package pwausage_test

import (
	"context"
	"fmt"
	"testing"
	"time"

	pwausage "github.com/moto-ogs/project-phoenix/observability/internal/adapters/pwausage"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

type testPWAUsageRow struct {
	bun.BaseModel `bun:"schema:iot,table:pwa_standalone_usage"`
	TenantID      int64     `bun:"tenant_id"`
	AccountID     int64     `bun:"account_id"`
	Portal        string    `bun:"portal"`
	FirstSeenAt   time.Time `bun:"first_seen_at"`
	LastSeenAt    time.Time `bun:"last_seen_at"`
}

func fetchPWAUsageRows(t *testing.T, db *bun.DB, accountID int64) []*testPWAUsageRow {
	t.Helper()
	var rows []*testPWAUsageRow
	err := db.NewSelect().Model(&rows).
		ModelTableExpr(`iot.pwa_standalone_usage AS "test_pwa_usage_row"`).
		Where("account_id = ?", accountID).
		Order("tenant_id ASC", "portal ASC").
		Scan(context.Background())
	require.NoError(t, err)
	return rows
}

func TestPWAStandaloneUsageRepository(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	repo := pwausage.NewPWAStandaloneUsageRepository(db)
	tenantID := testpkg.Tenant(t)
	account := testpkg.CreateTestAccount(t, db, fmt.Sprintf("pwa-usage-%d@example.com", time.Now().UnixNano()))
	testpkg.EnsureAccountTenant(t, db, account.ID, tenantID)
	// The caller's clock stamps every report (ADR 0277); the instants lie
	// years away from the database's clock, so a NOW() stamp would show.
	seen := time.Date(2031, time.June, 2, 12, 0, 0, 0, time.UTC)
	recordSeenAt := func(tenantID int64, portal string, at time.Time) error {
		return testpkg.WithTenantTx(t, context.Background(), db, tenantID, func(txCtx context.Context, _ bun.Tx) error {
			return repo.RecordSeen(txCtx, tenantID, account.ID, portal, at)
		})
	}
	recordSeen := func(tenantID int64, portal string) error { return recordSeenAt(tenantID, portal, seen) }

	t.Run("record seen is idempotent per tenant account and portal", func(t *testing.T) {
		require.NoError(t, recordSeen(tenantID, "staff"))
		rows := fetchPWAUsageRows(t, db, account.ID)
		require.Len(t, rows, 1)
		firstSeen := rows[0].FirstSeenAt
		assert.True(t, seen.Equal(firstSeen), "the report's instant stamps first_seen_at, got %s", firstSeen)

		later := seen.Add(time.Hour)
		require.NoError(t, recordSeenAt(tenantID, "staff", later))

		rows = fetchPWAUsageRows(t, db, account.ID)
		require.Len(t, rows, 1)
		assert.True(t, later.Equal(rows[0].LastSeenAt), "a repeated report advances last_seen_at to its instant, got %s", rows[0].LastSeenAt)
		assert.WithinDuration(t, firstSeen, rows[0].FirstSeenAt, time.Second)
	})

	t.Run("portals are separate rows", func(t *testing.T) {
		require.NoError(t, recordSeen(tenantID, "parent"))
		assert.Len(t, fetchPWAUsageRows(t, db, account.ID), 2)
	})

	t.Run("tenant role cannot bypass the write capability", func(t *testing.T) {
		err := testpkg.WithTenantTx(t, context.Background(), db, tenantID, func(txCtx context.Context, tx bun.Tx) error {
			_, updateErr := tx.ExecContext(txCtx,
				`UPDATE iot.pwa_standalone_usage SET last_seen_at = NOW() WHERE account_id = ?`, account.ID)
			return updateErr
		})
		require.Error(t, err)
	})

	t.Run("delete is tenant scoped", func(t *testing.T) {
		otherTenantID := testpkg.UniqueTestTenantID(t)
		testpkg.EnsureAccountTenant(t, db, account.ID, otherTenantID)
		err := testpkg.WithTenantTx(t, context.Background(), db, tenantID, func(txCtx context.Context, _ bun.Tx) error {
			return repo.RecordSeen(txCtx, otherTenantID, account.ID, "staff", seen)
		})
		require.Error(t, err, "the database capability must not bypass tenant RLS")
		require.NoError(t, recordSeen(otherTenantID, "staff"))
		_, err = db.ExecContext(context.Background(),
			`UPDATE iot.pwa_standalone_usage SET last_seen_at = ? WHERE account_id = ?`,
			seen.AddDate(0, 0, -40), account.ID)
		require.NoError(t, err)

		// The rows carry the caller's instant, so the cutoff counts back from
		// that clock, not from the database's.
		var deleted int
		err = testpkg.WithTenantTx(t, context.Background(), db, tenantID, func(txCtx context.Context, _ bun.Tx) error {
			var deleteErr error
			deleted, deleteErr = repo.DeleteLastSeenBefore(txCtx, tenantID, seen.AddDate(0, 0, -30))
			return deleteErr
		})
		require.NoError(t, err)
		assert.Equal(t, 2, deleted)

		rows := fetchPWAUsageRows(t, db, account.ID)
		require.Len(t, rows, 1)
		assert.Equal(t, otherTenantID, rows[0].TenantID)
	})
}
