package migrations

import (
	"testing"

	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/require"
)

func TestAccountParentPushMigrationRoundTrip(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupIsolatedTestDB(t)
	ctx := t.Context()
	guardian := testpkg.CreateTestParentGuardianChain(t, db)
	const legacy = "https://fcm.googleapis.com/fcm/send/legacy-parent"
	const device = "https://fcm.googleapis.com/fcm/send/account-parent"

	require.NoError(t, accountParentPushSubscriptionsDown(ctx, db))
	_, err := db.ExecContext(ctx, `INSERT INTO iot.push_subscriptions (tenant_id, account_id, portal, endpoint, p256dh, auth)
		VALUES (?, ?, 'parent', ?, 'key', 'auth')`, guardian.TenantID, guardian.AccountID, legacy)
	require.NoError(t, err)
	require.NoError(t, accountParentPushSubscriptionsUp(ctx, db))

	_, err = db.ExecContext(ctx, `INSERT INTO iot.push_subscriptions (account_id, portal, endpoint, p256dh, auth, token_family_id)
		VALUES (?, 'parent', ?, 'key', 'auth', 'device-family')`, guardian.AccountID, device)
	require.NoError(t, err)
	_, err = db.ExecContext(ctx, `INSERT INTO iot.push_subscriptions (account_id, portal, endpoint, p256dh, auth)
		VALUES (?, 'school', ?, 'key', 'auth')`, guardian.AccountID, device)
	require.Error(t, err, "staff and school devices still require a school")

	require.NoError(t, accountParentPushSubscriptionsDown(ctx, db))
	var endpoints []string
	require.NoError(t, db.NewRaw(`SELECT endpoint FROM iot.push_subscriptions
		WHERE tenant_id = ? AND account_id = ? AND portal = 'parent' ORDER BY endpoint`, guardian.TenantID, guardian.AccountID).
		Scan(ctx, &endpoints))
	require.Equal(t, []string{device, legacy}, endpoints)
	var family string
	require.NoError(t, db.NewRaw(`SELECT token_family_id FROM iot.push_subscriptions WHERE endpoint = ?`, device).Scan(ctx, &family))
	require.Equal(t, "device-family", family)
	require.NoError(t, accountParentPushSubscriptionsUp(ctx, db))
}
