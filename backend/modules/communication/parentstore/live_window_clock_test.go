//go:build testhooks

package parentstore_test

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/communication"
	store "github.com/moto-ogs/project-phoenix/modules/communication/parentstore"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestLiveWindowReadsTheStoreClock pins the store clock years away from the
// database's: publication is stamped from that clock, so the store's instant
// decides whether an announcement is live and a declaration still open
// (ADR 0277). Judged on the database's NOW(), a publication from the store's
// clock would lie in the future or the past depending on the day the suite
// runs.
func TestLiveWindowReadsTheStoreClock(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	tenantID := testpkg.Tenant(t)
	_, author := testpkg.CreateTestStaffWithAccountForTenant(t, db, tenantID, "Uhr", "Fenster")
	reader := testpkg.CreateTestAccount(t, db, fmt.Sprintf("live-window-%d@example.com", testpkg.UniqueSuffix()))
	pinned := time.Date(2031, time.June, 2, 12, 0, 0, 0, time.UTC)
	repo := store.NewParentAnnouncementRepository(db, noAudience{}, func() time.Time { return pinned })
	ctx := testpkg.TenantContext(tenantID)

	publish := func(t *testing.T) (int64, time.Time) {
		t.Helper()
		expires := pinned.AddDate(0, 0, 14)
		announcement := &communication.PortalParentAnnouncement{
			TenantID: tenantID, Title: "Ausflug", Body: "Bitte lesen", Priority: "info", Active: true,
			CreatedBy: author.ID, ExpiresAt: &expires,
		}
		require.NoError(t, testpkg.TenantCommand1(t, ctx, db, repo.Create, announcement))
		publishedAt := pinned.Add(-time.Hour)
		require.NoError(t, testpkg.TenantCommand2(t, ctx, db, repo.SetPublished, announcement.ID, &publishedAt))
		return announcement.ID, publishedAt
	}

	t.Run("a read and an acknowledgement reach the live announcement", func(t *testing.T) {
		id, publishedAt := publish(t)
		live, err := testpkg.TenantQuery4(t, ctx, db, repo.MarkRead, tenantID, id, reader.ID, publishedAt)
		require.NoError(t, err)
		assert.True(t, live, "published an hour before the store's instant, the announcement is live")

		live, err = testpkg.TenantQuery4(t, ctx, db, repo.MarkAcknowledged, tenantID, id, reader.ID, publishedAt)
		require.NoError(t, err)
		assert.True(t, live, "the acknowledgement guard reads the same instant")
	})

	t.Run("an opened declaration stays open until its deadline", func(t *testing.T) {
		id, publishedAt := publish(t)
		deadline := pinned.AddDate(0, 0, 7)
		_, err := db.ExecContext(context.Background(), `UPDATE users.parent_announcements
			SET delivery_mode = 'declaration', declaration_kind = 'consent', declaration_signers = 'any',
				email_audience = 'portal_only', requires_acknowledgement = FALSE, response_deadline = ?
			WHERE id = ? AND tenant_id = ?`, deadline, id, tenantID)
		require.NoError(t, err)
		live, err := testpkg.TenantQuery4(t, ctx, db, repo.MarkRead, tenantID, id, reader.ID, publishedAt)
		require.NoError(t, err)
		require.True(t, live)

		open, err := testpkg.TenantQuery2(t, ctx, db, repo.ReadOpenDeclarations, reader.ID, []int64{tenantID})
		require.NoError(t, err)
		require.Contains(t, open, id, "published before and due after the store's instant, the declaration is open")
		require.NotNil(t, open[id])
		assert.True(t, deadline.Equal(*open[id]), "the open declaration carries its deadline, got %s", *open[id])
	})
}
