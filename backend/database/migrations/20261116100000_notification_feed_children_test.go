package migrations

import (
	"testing"

	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun/dialect/pgdialect"
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

	_, account := testpkg.CreateTestStaffWithAccount(t, db, "Feed", "Children")
	studentIDs := make([]int64, 501)
	firstStudentID := testpkg.UniqueSuffix()
	for i := range studentIDs {
		studentIDs[i] = firstStudentID + int64(i)
	}
	_, err := db.ExecContext(ctx, `INSERT INTO platform.notification_feed_entries
		(tenant_id, account_id, type, title, body, deep_link, related_type, related_id, student_ids)
		VALUES (?, ?, 'parent_care_cancelled', 'Termin abgesagt', '', '/news', 'parent_announcement', 1, ?)`,
		testpkg.Tenant(t), account.ID, pgdialect.Array(studentIDs))
	require.NoError(t, err, "a feed entry keeps the complete scope of a large cancellation")
}
