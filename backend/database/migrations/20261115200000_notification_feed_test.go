package migrations

import (
	"testing"

	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// The feed migration rolls back to the erasure without the feed, whose
// preflight checks the fingerprint before it, and applies again.
func TestNotificationFeedMigrationRoundTrip(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupIsolatedTestDB(t)
	// The letter copies (#4813) follow the notification feed at the head; they go first.
	require.NoError(t, parentLetterCopiesDown(t.Context(), db))
	ctx := t.Context()
	exists := func() bool {
		var found bool
		require.NoError(t, db.NewRaw(`SELECT to_regclass('platform.notification_feed_entries') IS NOT NULL`).Scan(ctx, &found))
		return found
	}
	definitions := func() string {
		var all string
		require.NoError(t, db.NewRaw(`SELECT string_agg(pg_get_functiondef(to_regprocedure(name)), E'\n') FROM unnest(ARRAY[
			'platform.school_erasure_plan()', 'platform.school_erasure_preflight(bigint,bigint)', 'platform.school_erasure_delete(bigint)',
			'platform.school_erasure_preview(bigint,bigint)', 'platform.school_erasure_assert_empty(bigint,jsonb)',
			'platform.erase_closed_demo_visitors()', 'auth.erase_unused_accounts()']) AS name`).Scan(ctx, &all))
		return all
	}
	require.True(t, exists())
	assert.Contains(t, definitions(), notificationFeedFingerprint)

	require.NoError(t, notificationFeedDown(ctx, db))
	assert.False(t, exists())
	installed := definitions()
	assert.NotContains(t, installed, notificationFeedTable, "no erasure function names the dropped table")
	assert.Contains(t, installed, notificationFeedBaseFingerprint)

	require.NoError(t, notificationFeedUp(ctx, db))
	assert.True(t, exists())
}
