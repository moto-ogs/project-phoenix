package migrations

import (
	"testing"

	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestNotificationFeedSchoolOnlyMigrationRoundTrip(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupIsolatedTestDB(t)
	ctx := t.Context()
	_, account := testpkg.CreateTestStaffWithAccount(t, db, "Schulportal", "Link")

	insert := func(deepLink, schoolDeepLink string) error {
		_, err := db.ExecContext(ctx, `INSERT INTO platform.notification_feed_entries
			(tenant_id, account_id, type, title, body, deep_link, school_deep_link, related_type, related_id)
			VALUES (?, ?, 'school_closing_day_changed', 'Schließtag', '', ?, ?, 'closing_day', 1)`,
			testpkg.Tenant(t), account.ID, deepLink, schoolDeepLink)
		return err
	}

	require.NoError(t, insert("", "/school/kalender"))
	assert.Error(t, insert("", ""), "an entry without either portal link is invalid")
	assert.Error(t, insert("//example.org", "/school/kalender"), "the OGS link remains app-relative")

	require.NoError(t, notificationFeedSchoolOnlyDown(ctx, db))
	var count int
	require.NoError(t, db.NewRaw(`SELECT count(*) FROM platform.notification_feed_entries WHERE deep_link = ''`).Scan(ctx, &count))
	assert.Zero(t, count)
	require.NoError(t, notificationFeedSchoolOnlyUp(ctx, db))
}
