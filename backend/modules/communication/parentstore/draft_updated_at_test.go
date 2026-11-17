//go:build testhooks

package parentstore_test

import (
	"testing"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/communication"
	store "github.com/moto-ogs/project-phoenix/modules/communication/parentstore"
	recordports "github.com/moto-ogs/project-phoenix/modules/communication/ports"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/require"
)

// noAudience satisfies the repository's audience dependency; creating,
// editing and re-reading a draft never reach it.
type noAudience struct {
	recordports.AnnouncementAudienceReads
}

// TestDraftEditReturnsStoredUpdatedAt pins the store clock years away from
// the real day: users.parent_announcements stamps updated_at with the
// database clock by trigger, so the value an edit returns must be the stored
// one, not the injected clock's (ADR 0267).
func TestDraftEditReturnsStoredUpdatedAt(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	tenantID := testpkg.Tenant(t)
	_, account := testpkg.CreateTestStaffWithAccountForTenant(t, db, tenantID, "Uhr", "Gepinnt")
	pinned := time.Date(2031, time.March, 3, 9, 30, 0, 0, time.UTC)
	repo := store.NewParentAnnouncementRepository(db, noAudience{}, func() time.Time { return pinned })
	ctx := testpkg.TenantContext(tenantID)

	draft := &communication.PortalParentAnnouncement{
		TenantID: tenantID, Title: "Entwurf", Body: "Erste Fassung", Priority: "info", Active: true, CreatedBy: account.ID,
	}
	require.NoError(t, testpkg.TenantCommand1(t, ctx, db, repo.Create, draft))

	edited, err := testpkg.TenantQuery1(t, ctx, db, repo.FindByID, draft.ID)
	require.NoError(t, err)
	edited.Body = "Zweite Fassung"
	require.NoError(t, testpkg.TenantCommand1(t, ctx, db, repo.Update, edited))

	stored, err := testpkg.TenantQuery1(t, ctx, db, repo.FindByID, draft.ID)
	require.NoError(t, err)
	require.Equal(t, "Zweite Fassung", stored.Body)
	require.True(t, edited.UpdatedAt.Equal(stored.UpdatedAt),
		"edit returned updated_at %s, stored %s", edited.UpdatedAt, stored.UpdatedAt)
}
