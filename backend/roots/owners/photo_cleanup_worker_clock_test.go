package owners

import (
	"context"
	"log/slog"
	"testing"
	"time"

	nativeUploads "github.com/moto-ogs/project-phoenix/modules/delivery/objects"
	fileStorageCompose "github.com/moto-ogs/project-phoenix/modules/filestorage/compose"
	transactionruntime "github.com/moto-ogs/project-phoenix/modules/transactionruntime/compose"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

// TestFileStoreCleanerSweepsOnTheWorkersClock queues a photo cleanup on a
// clock years ahead of the real day and runs the Worker's file cleanup on the
// same clock: the intent is due by that clock, so the sweep settles it. A
// sweep on the real clock would still see it as not yet due (#7104, ADR 0278).
func TestFileStoreCleanerSweepsOnTheWorkersClock(t *testing.T) {
	t.Parallel()
	admin := testpkg.SetupTestDB(t)
	db, err := transactionruntime.NewDatabase(admin)
	require.NoError(t, err)
	at := time.Date(2031, time.June, 2, 12, 0, 0, 0, time.UTC)
	now := func() time.Time { return at }
	ctx := testpkg.WithTenantRuntime(t, testpkg.Ctx(t), admin)
	queue := fileStorageCompose.NewUploadCleanup(admin, "student-photos", now)
	require.NoError(t, testpkg.WithinTenantTransaction(ctx, admin, testpkg.Tenant(t), func(txCtx context.Context, _ bun.Tx) error {
		return queue.Queue(txCtx, "/uploads/student-photos/worker-clock.jpg")
	}))

	before := testpkg.DatabaseNow(t, admin)
	var removed int
	require.NoError(t, testpkg.WithinTenantTransaction(ctx, admin, testpkg.Tenant(t), func(txCtx context.Context, _ bun.Tx) error {
		removed, err = newFileStoreCleaner(db, nil, slog.New(slog.DiscardHandler), now, nativeUploads.UploadFiles{})(txCtx)
		return err
	}))
	after := testpkg.DatabaseNow(t, admin)
	assert.Equal(t, 1, removed, "the intent is due by the Worker's clock")

	var cleanedAt *time.Time
	require.NoError(t, admin.NewRaw(`SELECT cleaned_at FROM documents.file_cleanup WHERE tenant_id = ? AND filename_stored = ?`,
		testpkg.Tenant(t), "worker-clock.jpg").Scan(ctx, &cleanedAt))
	require.NotNil(t, cleanedAt)
	assert.True(t, !cleanedAt.Before(before) && !cleanedAt.After(after), "retention ages the settlement on the database clock")
}
