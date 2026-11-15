package migrations

import (
	"testing"

	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// The school link of the feed (#7139) rolls back and applies again, and its
// check refuses a link that leaves the app.
func TestNotificationFeedSchoolLinkMigrationRoundTrip(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupIsolatedTestDB(t)
	ctx := t.Context()
	exists := func() bool {
		var found bool
		require.NoError(t, db.NewRaw(`SELECT EXISTS (SELECT 1 FROM information_schema.columns
			WHERE table_schema = 'platform' AND table_name = 'notification_feed_entries' AND column_name = 'school_deep_link')`).Scan(ctx, &found))
		return found
	}
	require.True(t, exists())
	require.NoError(t, notificationFeedSchoolLinkDown(ctx, db))
	assert.False(t, exists())
	require.NoError(t, notificationFeedSchoolLinkUp(ctx, db))
	assert.True(t, exists())

	_, account := testpkg.CreateTestStaffWithAccount(t, db, "Link", "Check")
	insert := func(link string) error {
		_, err := db.ExecContext(ctx, `INSERT INTO platform.notification_feed_entries
			(tenant_id, account_id, type, title, body, deep_link, school_deep_link, related_type, related_id)
			VALUES (?, ?, 'instance_cancelled', 'Termin abgesagt', '', '/mein-dienstplan', ?, 'activity_instance', 1)`,
			testpkg.Tenant(t), account.ID, link)
		return err
	}
	require.NoError(t, insert("/school/aufsichten"))
	assert.Error(t, insert("//example.org"), "a link that leaves the app")
}
