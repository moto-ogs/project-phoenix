package notifications_test

import (
	"context"
	"testing"

	"github.com/moto-ogs/project-phoenix/api"
	"github.com/moto-ogs/project-phoenix/modules/delivery/compose"

	"github.com/moto-ogs/project-phoenix/modules/delivery/internal/notifications"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestParentDeviceDeliveryFollowsCurrentGuardianSchools(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	account := testpkg.CreateTestAccount(t, db, "push-parent-mixed-roles")
	guardianTenantID := testpkg.UniqueTestTenantID(t)
	staffTenantID := testpkg.UniqueTestTenantID(t)
	testpkg.EnsureTestTenant(t, db, guardianTenantID)
	testpkg.EnsureTestTenant(t, db, staffTenantID)

	testpkg.MapAccountToTenant(t, db, account.ID, guardianTenantID)
	testpkg.MapAccountToTenant(t, db, account.ID, staffTenantID)

	var guardianRoleID, staffRoleID int64
	require.NoError(t, db.NewSelect().
		ColumnExpr("id").
		TableExpr("auth.roles").
		Where("name = ?", "guardian").
		Scan(context.Background(), &guardianRoleID))
	require.NoError(t, db.NewSelect().
		ColumnExpr("id").
		TableExpr("auth.roles").
		Where("name = ?", "user").
		Scan(context.Background(), &staffRoleID))

	_, err := db.ExecContext(context.Background(), `
		INSERT INTO auth.account_roles (account_id, role_id, tenant_id)
		VALUES (?, ?, ?), (?, ?, ?)`,
		account.ID, guardianRoleID, guardianTenantID,
		account.ID, staffRoleID, staffTenantID)
	require.NoError(t, err)

	service, err := api.NewPushSubscriptionTestService(testpkg.NewDatabase(t, db), testpkg.TenantRuntime(t, db),
		notifications.VAPIDConfig{PublicKey: "pub", PrivateKey: "priv", Subscriber: "mailto:test@example.org"})
	require.NoError(t, err)
	const endpoint = "https://fcm.googleapis.com/fcm/send/guardian-school-change"
	require.NoError(t, service.SubscribeParent(context.Background(), account.ID, notifications.PushSubscriptionInput{Endpoint: endpoint, P256dh: "p256dh-key", Auth: "auth-key"}))
	t.Cleanup(func() { assert.NoError(t, service.UnsubscribeParent(context.Background(), account.ID, endpoint)) })
	repo := compose.NewPushSubscriptionRepository(db)
	eligibleAt := func(schoolID int64) []int64 {
		subs, err := testpkg.TenantQuery2(t, testpkg.TenantContext(schoolID), db, repo.FindForGuardians, []int64{account.ID}, nil)
		require.NoError(t, err)
		var ids []int64
		for _, sub := range subs {
			require.Equal(t, schoolID, sub.TenantID)
			ids = append(ids, sub.ID)
		}
		return ids
	}

	guardianDevices := eligibleAt(guardianTenantID)
	require.Len(t, guardianDevices, 1)
	assert.Empty(t, eligibleAt(staffTenantID), "a staff mapping is not a guardian authorization")

	_, err = db.ExecContext(context.Background(), `
		INSERT INTO auth.account_roles (account_id, role_id, tenant_id) VALUES (?, ?, ?)`,
		account.ID, guardianRoleID, staffTenantID)
	require.NoError(t, err)
	assert.Equal(t, guardianDevices, eligibleAt(staffTenantID), "a new guardian role uses the same device without another registration")

	_, err = db.ExecContext(context.Background(), `
		UPDATE auth.account_tenants SET status = 'inactive' WHERE account_id = ? AND tenant_id = ?`,
		account.ID, guardianTenantID)
	require.NoError(t, err)
	assert.Empty(t, eligibleAt(guardianTenantID), "an inactive mapping immediately stops delivery")
	assert.Equal(t, guardianDevices, eligibleAt(staffTenantID))
}
