package account_test

import (
	"fmt"
	"net/http"
	"strconv"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/api"
	"github.com/moto-ogs/project-phoenix/api/testutil"
	identityaccessCompose "github.com/moto-ogs/project-phoenix/modules/identityaccess/compose"
	authAPI "github.com/moto-ogs/project-phoenix/modules/identityaccess/inbound/account"
	transactionFailures "github.com/moto-ogs/project-phoenix/modules/transactionruntime"
	"github.com/moto-ogs/project-phoenix/tenant"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

func TestTenantAndOrganizationAdminsCannotMutateGlobalPermissionCatalog(t *testing.T) {
	t.Parallel()

	tc, router := setupProtectedRouter(t)
	actor := testpkg.CreateTestAccount(t, tc.db, "permission-catalog-scoped-admin")
	permissions := []string{"admin:*"}

	for _, tt := range []struct {
		name  string
		scope string
	}{
		{name: "tenant", scope: tenant.ScopeTenant},
	} {
		t.Run(tt.name, func(t *testing.T) {
			claims := testutil.AdminTestClaims(int(actor.ID))
			claims.Scope = tt.scope

			listReq := testutil.NewJSONRequest(t, http.MethodGet, "/auth/permissions", nil)
			listResp := testutil.ExecuteWithAuthPermissions(t, router, listReq, claims, permissions)
			testutil.AssertSuccessResponse(t, listResp, http.StatusOK)

			createResource := fmt.Sprintf("f18-create-%s-%d", tt.name, time.Now().UnixNano())
			createReq := testutil.NewJSONRequest(t, http.MethodPost, "/auth/permissions", map[string]string{
				"name":        createResource + ":read",
				"description": "F18 scoped create attempt",
				"resource":    createResource,
				"action":      "read",
			})
			createResp := testutil.ExecuteWithAuthPermissions(t, router, createReq, claims, permissions)
			assert.Equal(t, http.StatusForbidden, createResp.Code, "Body: %s", createResp.Body.String())
			createCount, err := tc.db.NewSelect().
				TableExpr("auth.permissions").
				Where("name = ?", createResource+":read").
				Count(testpkg.Ctx(t))
			require.NoError(t, err)
			assert.Zero(t, createCount)
		})
	}
}

func TestPlatformScopeCanMutateGlobalPermissionCatalog(t *testing.T) {
	t.Parallel()

	fixtureDB := testpkg.SetupTestDB(t)
	router := setupPlatformPermissionRoute(t)

	actor := testpkg.CreateTestAccount(t, fixtureDB, "permission-catalog-platform")
	claims := testutil.AdminTestClaims(int(actor.ID))
	claims.Scope = tenant.ScopePlatform
	claims.TenantID = 0
	permissions := []string{"admin:*"}

	resource := fmt.Sprintf("f18-platform-%d", time.Now().UnixNano())
	createReq := testutil.NewJSONRequest(t, http.MethodPost, "/auth/permissions", map[string]string{
		"name":        resource + ":read",
		"description": "F18 platform create",
		"resource":    resource,
		"action":      "read",
	})
	createResp := testutil.ExecuteWithAuthPermissions(t, router, createReq, claims, permissions)
	require.Equal(t, http.StatusCreated, createResp.Code, "Body: %s", createResp.Body.String())
	data := testutil.ParseJSONResponse(t, createResp.Body.Bytes())["data"].(map[string]interface{})
	permissionID, err := strconv.ParseInt(data["id"].(string), 10, 64)
	require.NoError(t, err)
	testpkg.OwnTestPermission(t, fixtureDB, permissionID)

}

func setupPlatformPermissionRoute(t *testing.T) chi.Router {
	t.Helper()

	serveDB := testpkg.SetupServeTestDB(t)
	t.Cleanup(func() { require.NoError(t, serveDB.Close()) })

	svc := setupAuthModuleOn(t, serveDB)
	authResource := authAPI.NewResource(svc.Auth, svc.Invitation, nil, svc.AccountAuthentication, identityaccessCompose.TenantUnitOfWork{}, transactionFailures.IsConstraintViolation, &settingsDouble{})
	authResource.RoleGrants = api.AccountRoleGrantPolicy()
	router := testutil.NewTenantRouter(serveDB)
	router.Mount("/auth", authResource.Router(api.TenantSessionChain))
	return router
}
