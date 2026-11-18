//go:build testhooks

package notifications_test

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/api"
	"github.com/moto-ogs/project-phoenix/api/testutil"
	"github.com/moto-ogs/project-phoenix/modules/delivery/internal/notifications"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// A person switches one notification on and off and then all of them off,
// through the real routes of the staff portal and of moto schule. The read
// route of the same portal shows each decision.
func TestNotificationPreferenceRoutesStoreTheDecisionOfThePortal(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	module, err := api.NewDeliveryTestModule(testpkg.NewDatabase(t, db), testpkg.TenantRuntime(t, db))
	require.NoError(t, err)
	router := module.NotificationPreferenceRouterForTests()
	_, account := testpkg.CreateTestStaffWithAccount(t, db, "Wahl", "Schreiben")
	testpkg.MapAccountToTenant(t, db, account.ID, testpkg.Tenant(t))
	testpkg.AssignLehrkraftSystemRole(t, db, account.ID, testpkg.Tenant(t))
	notificationBudgetSettings(t, db, testpkg.Tenant(t), true)

	for _, portal := range []struct{ name, scope, base, kind string }{
		{"staff", "", "/api/notifications/preferences/", notifications.TypePickupUpcoming},
		{"school", "school", "/school/notifications/preferences/", notifications.TypeSchoolClassAbsenceReported},
	} {
		t.Run(portal.name, func(t *testing.T) {
			claims := testutil.TeacherTestClaims(int(account.ID))
			if portal.scope != "" {
				claims.Scope = portal.scope
			}
			bearer := testutil.WithJWTBearer(testutil.MintTestJWT(t, claims))
			write := func(method, path string, body any) {
				t.Helper()
				response := testutil.ExecuteRequestForTest(t, router, testutil.NewAuthenticatedRequest(t, method, portal.base+path, body, bearer))
				require.Equal(t, http.StatusNoContent, response.Code, response.Body.String())
			}
			enabled := func() map[string]bool {
				t.Helper()
				response := testutil.ExecuteRequestForTest(t, router, testutil.NewAuthenticatedRequest(t, http.MethodGet, portal.base, nil, bearer))
				require.Equal(t, http.StatusOK, response.Code, response.Body.String())
				var read struct {
					Data struct {
						Types []struct {
							Key     string `json:"key"`
							Enabled bool   `json:"enabled"`
						} `json:"types"`
					} `json:"data"`
				}
				require.NoError(t, json.Unmarshal(response.Body.Bytes(), &read))
				out := make(map[string]bool, len(read.Data.Types))
				for _, kind := range read.Data.Types {
					out[kind.Key] = kind.Enabled
				}
				require.Contains(t, out, portal.kind)
				return out
			}

			write(http.MethodPut, portal.kind, map[string]any{"enabled": true})
			assert.True(t, enabled()[portal.kind])
			write(http.MethodPut, portal.kind, map[string]any{"enabled": false})
			assert.False(t, enabled()[portal.kind])

			write(http.MethodPut, portal.kind, map[string]any{"enabled": true})
			write(http.MethodDelete, "", nil)
			for kind, on := range enabled() {
				assert.False(t, on, "%s stays on after all were switched off", kind)
			}
		})
	}
}
