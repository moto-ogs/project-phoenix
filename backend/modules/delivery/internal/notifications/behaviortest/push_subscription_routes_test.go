//go:build testhooks

package notifications_test

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/api"
	"github.com/moto-ogs/project-phoenix/api/testutil"
	deliveryCompose "github.com/moto-ogs/project-phoenix/modules/delivery/compose"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// A device registers for Web Push, and leaves again, through the real routes
// of the staff portal and of moto schule. Each portal keeps a row of its own.
func TestPushSubscriptionRoutesRegisterAndRemoveTheDeviceOfThePortal(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	database, unit := testpkg.NewDatabase(t, db), testpkg.TenantRuntime(t, db)
	module, err := api.NewDeliveryTestModule(database, unit)
	require.NoError(t, err)
	// The test configuration carries no Web Push keys; the routes need a pair.
	module.PushSubscriptions, err = api.NewPushSubscriptionTestService(database, unit,
		deliveryCompose.VAPIDConfig{PublicKey: "pub", PrivateKey: "priv", Subscriber: "mailto:test@example.org"})
	require.NoError(t, err)
	router := module.NotificationPreferenceRouterForTests()
	_, account := testpkg.CreateTestStaffWithAccount(t, db, "Push", "Geraet")
	testpkg.MapAccountToTenant(t, db, account.ID, testpkg.Tenant(t))
	testpkg.AssignLehrkraftSystemRole(t, db, account.ID, testpkg.Tenant(t))

	for _, portal := range []struct{ scope, base, row string }{
		{"", "/api/notifications/push", "staff"},
		{"school", "/school/notifications/push", "school"},
	} {
		t.Run(portal.row, func(t *testing.T) {
			claims := testutil.TeacherTestClaims(int(account.ID))
			if portal.scope != "" {
				claims.Scope = portal.scope
			}
			bearer := testutil.WithJWTBearer(testutil.MintTestJWT(t, claims))
			endpoint := fmt.Sprintf("https://fcm.googleapis.com/fcm/send/route-%s-%d", portal.row, account.ID)
			rows := func() int {
				count, err := db.NewSelect().TableExpr("iot.push_subscriptions").
					Where("account_id = ? AND portal = ? AND endpoint = ?", account.ID, portal.row, endpoint).
					Count(testpkg.TenantContext(testpkg.Tenant(t)))
				require.NoError(t, err)
				return int(count)
			}

			response := testutil.ExecuteRequestForTest(t, router, testutil.NewAuthenticatedRequest(t, http.MethodGet, portal.base+"/public-key", nil, bearer))
			require.Equal(t, http.StatusOK, response.Code, response.Body.String())
			var key struct {
				Data struct {
					PublicKey string `json:"public_key"`
				} `json:"data"`
			}
			require.NoError(t, json.Unmarshal(response.Body.Bytes(), &key))
			assert.Equal(t, "pub", key.Data.PublicKey)

			body := map[string]any{"endpoint": endpoint, "keys": map[string]string{"p256dh": "route-p256dh", "auth": "route-auth"}}
			response = testutil.ExecuteRequestForTest(t, router, testutil.NewAuthenticatedRequest(t, http.MethodPost, portal.base+"/subscriptions", body, bearer))
			require.Equal(t, http.StatusNoContent, response.Code, response.Body.String())
			assert.Equal(t, 1, rows(), "the device is registered for its portal")

			response = testutil.ExecuteRequestForTest(t, router, testutil.NewAuthenticatedRequest(t, http.MethodDelete,
				portal.base+"/subscriptions?endpoint="+url.QueryEscape(endpoint), nil, bearer))
			require.Equal(t, http.StatusNoContent, response.Code, response.Body.String())
			assert.Zero(t, rows(), "the device is gone")
		})
	}
}
