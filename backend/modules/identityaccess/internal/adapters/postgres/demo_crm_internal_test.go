package postgres

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/identityaccess/internal/domain"
	"github.com/moto-ogs/project-phoenix/tenant"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/require"
)

func TestDemoCRMQueueAtomicityLeasesConsentAndPayloadErasure(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupIsolatedTestDB(t)
	ctx := testpkg.WithTenantRuntime(t, t.Context(), db)
	now := time.Date(2026, time.November, 20, 18, 0, 0, 0, time.UTC)
	store := NewStore(db, func() time.Time { return now })
	access := domain.DemoAccess{Email: "crm-fixture@example.invalid", FirstName: "Kim", LastName: "Example", SchoolName: "OGS", SchoolSlug: "crm-fixture", ContactOptIn: true, Phone: "+49 fixture", TokenHash: "crm-fixture", CreatedAt: now, ExpiresAt: now.Add(time.Hour)}
	tx := func(fn func(context.Context) error) { t.Helper(); require.NoError(t, tenant.WithinAdmin(ctx, fn)) }
	tx(func(ctx context.Context) error {
		var err error
		access.ID, err = store.InsertDemoAccess(ctx, access)
		return err
	})
	rollback := errors.New("rollback")
	err := tenant.WithinAdmin(ctx, func(ctx context.Context) error {
		require.NoError(t, store.QueueDemoCRM(ctx, access, now, false))
		return rollback
	})
	require.ErrorIs(t, err, rollback)
	var count int
	require.NoError(t, db.NewRaw(`SELECT count(*) FROM auth.demo_crm_jobs`).Scan(ctx, &count))
	require.Zero(t, count)
	tx(func(ctx context.Context) error { return store.QueueDemoCRM(ctx, access, now, false) })
	tx(func(ctx context.Context) error { return store.QueueDemoCRM(ctx, access, now, false) })
	tx(func(ctx context.Context) error { return store.QueueDemoCRM(ctx, access, now, true) })
	unconsented := access
	unconsented.ContactOptIn = false
	tx(func(ctx context.Context) error { return store.QueueDemoCRM(ctx, unconsented, now, true) })
	require.NoError(t, db.NewRaw(`SELECT count(*) FROM auth.demo_crm_jobs`).Scan(ctx, &count))
	require.Equal(t, 2, count, "an old unconsented link must neither enqueue nor erase newer consented jobs")
	var first domain.DemoCRMJob
	tx(func(ctx context.Context) error {
		job, found, err := store.ClaimDemoCRM(ctx, now)
		require.True(t, found)
		first = job
		return err
	})
	require.Equal(t, access.Phone, first.Contact.Phone)
	tx(func(ctx context.Context) error {
		_, found, err := store.ClaimDemoCRM(ctx, now)
		require.False(t, found, "one in-flight job per address")
		return err
	})
	tx(func(ctx context.Context) error {
		allowed, err := store.DemoCRMAuthorized(ctx, first, now)
		require.True(t, allowed)
		return err
	})
	// A stale worker must not delete a newly leased retry.
	later := now.Add(2 * time.Minute)
	var recovered domain.DemoCRMJob
	tx(func(ctx context.Context) error {
		job, found, err := store.ClaimDemoCRM(ctx, later)
		require.True(t, found)
		recovered = job
		return err
	})
	require.NotEqual(t, first.Lease, recovered.Lease)
	tx(func(ctx context.Context) error { return store.FinishDemoCRM(ctx, first, later, true) })
	require.NoError(t, db.NewRaw(`SELECT count(*) FROM auth.demo_crm_jobs`).Scan(ctx, &count))
	require.Equal(t, 2, count)
	tx(func(ctx context.Context) error { return store.FinishDemoCRM(ctx, recovered, later, true) })
	tx(func(ctx context.Context) error {
		job, found, err := store.ClaimDemoCRM(ctx, later)
		require.True(t, found)
		require.Empty(t, job.Contact.Phone)
		first = job
		return err
	})
	// A later accepted request removes consent while the old link still exists.
	access.TokenHash = "crm-revoked"
	access.ContactOptIn = false
	tx(func(ctx context.Context) error { _, err := store.InsertDemoAccess(ctx, access); return err })
	tx(func(ctx context.Context) error {
		allowed, err := store.DemoCRMAuthorized(ctx, first, later)
		require.False(t, allowed)
		return err
	})
	tx(func(ctx context.Context) error { return store.QueueDemoCRM(ctx, access, later, false) })
	require.NoError(t, db.NewRaw(`SELECT count(*) FROM auth.demo_crm_jobs`).Scan(ctx, &count))
	require.Zero(t, count, "withdrawal erases queued contact data")
}
