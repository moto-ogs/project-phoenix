package migrations

import (
	"testing"

	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// The children of a feed entry roll back with the entries of guardians and
// apply again.
func TestNotificationFeedChildrenMigrationRoundTrip(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupIsolatedTestDB(t)
	ctx := t.Context()
	hasColumn := func() bool {
		var found bool
		require.NoError(t, db.NewRaw(`SELECT EXISTS (SELECT 1 FROM information_schema.columns
			WHERE table_schema = 'platform' AND table_name = 'notification_feed_entries' AND column_name = 'student_ids')`).Scan(ctx, &found))
		return found
	}
	require.True(t, hasColumn())
	require.NoError(t, notificationFeedChildrenDown(ctx, db))
	assert.False(t, hasColumn())
	require.NoError(t, notificationFeedChildrenUp(ctx, db))
	assert.True(t, hasColumn())
}
