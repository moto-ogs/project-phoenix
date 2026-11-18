//go:build testhooks

package notifications_test

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"testing"

	"github.com/moto-ogs/project-phoenix/api"
	"github.com/moto-ogs/project-phoenix/api/testutil"
	"github.com/moto-ogs/project-phoenix/modules/delivery/compose"
	"github.com/moto-ogs/project-phoenix/modules/delivery/internal/notifications"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestParentDeviceRegistrationDoesNotRequireASchool(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	database, unit := testpkg.NewDatabase(t, db), testpkg.TenantRuntime(t, db)
	module, err := api.NewDeliveryTestModule(database, unit)
	require.NoError(t, err)
	module.PushSubscriptions, err = api.NewPushSubscriptionTestService(database, unit,
		notifications.VAPIDConfig{PublicKey: "pub", PrivateKey: "priv", Subscriber: "mailto:test@example.org"})
	require.NoError(t, err)
	router := module.NotificationPreferenceRouterForTests()

	first := testpkg.CreateTestAccount(t, db, "parent-device-without-school")
	second := testpkg.CreateTestAccount(t, db, "parent-device-shared-browser")
	endpoint := fmt.Sprintf("https://fcm.googleapis.com/fcm/send/parent-%d", first.ID)
	t.Cleanup(func() {
		assert.NoError(t, module.PushSubscriptions.UnsubscribeParent(context.Background(), first.ID, endpoint))
		assert.NoError(t, module.PushSubscriptions.UnsubscribeParent(context.Background(), second.ID, endpoint))
	})
	body := map[string]any{"endpoint": endpoint, "keys": map[string]string{"p256dh": "p256dh-key", "auth": "auth-key"}}
	request := func(accountID int64, method, path string, body any, status int) {
		t.Helper()
		bearer := testutil.WithJWTBearer(testutil.MintTestJWT(t, testutil.ParentTestClaims(int(accountID))))
		response := testutil.ExecuteRequestForTest(t, router, testutil.NewAuthenticatedRequest(t, method, path, body, bearer))
		require.Equal(t, status, response.Code, response.Body.String())
	}
	deviceOwners := func() []int64 {
		t.Helper()
		var ids []int64
		require.NoError(t, db.NewSelect().TableExpr("iot.push_subscriptions").
			ColumnExpr("account_id").Where("endpoint = ? AND portal = 'parent'", endpoint).Scan(context.Background(), &ids))
		return ids
	}

	const pushPath = "/parent/me/push"
	subscriptionsPath := pushPath + "/subscriptions"
	deletePath := subscriptionsPath + "?endpoint=" + url.QueryEscape(endpoint)

	request(first.ID, http.MethodGet, pushPath+"/public-key", nil, http.StatusOK)
	request(first.ID, http.MethodPost, subscriptionsPath, body, http.StatusNoContent)
	require.Equal(t, []int64{first.ID}, deviceOwners())
	eligible, err := testpkg.TenantQuery2(t, testpkg.Ctx(t), db, compose.NewPushSubscriptionRepository(db).FindForGuardians, []int64{first.ID}, nil)
	require.NoError(t, err)
	require.Empty(t, eligible, "registration alone does not authorize school delivery")

	request(second.ID, http.MethodPost, subscriptionsPath, body, http.StatusNoContent)
	require.Equal(t, []int64{second.ID}, deviceOwners(), "a shared browser belongs to the most recent parent account")
	request(first.ID, http.MethodDelete, deletePath, nil, http.StatusNoContent)
	require.Equal(t, []int64{second.ID}, deviceOwners(), "the previous account cannot remove the current device")
	request(second.ID, http.MethodDelete, deletePath, nil, http.StatusNoContent)
	require.Empty(t, deviceOwners())
}
