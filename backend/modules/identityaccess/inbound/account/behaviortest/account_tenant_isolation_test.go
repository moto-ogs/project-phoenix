package account_test

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	rootAPI "github.com/moto-ogs/project-phoenix/api"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/api/testutil"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess"
	"github.com/moto-ogs/project-phoenix/tenant"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

type accountIsolationEnv struct {
	tc              *testContext
	router          chi.Router
	tenantID        int64
	foreignTenantID int64
	claims          testutil.Claims
}

func newAccountIsolationEnv(t *testing.T) *accountIsolationEnv {
	t.Helper()
	tc := setupAuthRoute(t)
	router := testutil.NewTenantRouter(tc.db)
	router.Mount("/auth", tc.resource.Router(rootAPI.TenantSessionChain))
	tenantID := testpkg.Tenant(t)
	actor := testpkg.CreateTestAccount(t, tc.db, "account-scope-actor")
	testpkg.OwnTestAccount(t, tc.db, actor.ID)
	foreignTenantID, _ := testpkg.CreateTestTenant(t, tc.db)
	return &accountIsolationEnv{
		tc:              tc,
		router:          router,
		tenantID:        tenantID,
		foreignTenantID: foreignTenantID,
		claims:          testutil.AdminTestClaimsForTenant(int(actor.ID), tenantID),
	}
}

func (e *accountIsolationEnv) accountForTenant(t *testing.T, prefix string, tenantID int64) (int64, string) {
	t.Helper()
	account := testpkg.CreateTestAccount(t, e.tc.db, prefix)
	testpkg.UnclaimTestAccount(t, e.tc.db, account.ID)
	testpkg.MapAccountToTenant(t, e.tc.db, account.ID, tenantID)
	return account.ID, account.Email
}

func (e *accountIsolationEnv) foreignAccount(t *testing.T, prefix string) (int64, string) {
	t.Helper()
	return e.accountForTenant(t, prefix, e.foreignTenantID)
}

func (e *accountIsolationEnv) missingAccountID(t *testing.T) int64 {
	t.Helper()
	account := testpkg.CreateTestAccount(t, e.tc.db, "account-scope-missing")
	_, err := e.tc.db.NewDelete().TableExpr("auth.accounts").Where("id = ?", account.ID).Exec(context.Background())
	require.NoError(t, err)
	return account.ID
}

func (e *accountIsolationEnv) execute(t *testing.T, claims testutil.Claims, method, path string, body any) *httptest.ResponseRecorder {
	t.Helper()
	req := testutil.NewJSONRequest(t, method, path, body)
	return testutil.ExecuteWithAuth(t, e.router, req, claims)
}

// schoolCtx is the caller context of the school's administrator.
func (e *accountIsolationEnv) schoolCtx() context.Context {
	return tenant.WithTenantID(context.Background(), e.tenantID)
}

func TestAccountManagementOwnTenantAllowed(t *testing.T) {
	t.Parallel()
	e := newAccountIsolationEnv(t)
	account := testpkg.CreateTestAccount(t, e.tc.db, "account-scope-local")

	got, err := e.tc.resource.Sessions.FindManageableAccount(tenant.WithTenantID(context.Background(), e.tenantID), account.ID)
	require.NoError(t, err)
	assert.Equal(t, account.ID, got.ID)

	require.NoError(t, e.tc.resource.Sessions.DeactivateAccount(e.schoolCtx(), account.ID))
	assert.False(t, readStoredAccount(t, testpkg.Ctx(t), e.tc.db, account.ID).Active)
	require.NoError(t, e.tc.resource.Sessions.ActivateAccount(e.schoolCtx(), account.ID))
	assert.True(t, readStoredAccount(t, testpkg.Ctx(t), e.tc.db, account.ID).Active)
}

func assertAccountActionStatus(t *testing.T, e *accountIsolationEnv, claims testutil.Claims, method, path string, body any, status int) {
	t.Helper()
	rr := e.execute(t, claims, method, path, body)
	require.Equal(t, status, rr.Code, rr.Body.String())
}

func TestAccountManagementRBACForeignAccountDoesNotLeakExistence(t *testing.T) {
	t.Parallel()
	e := newAccountIsolationEnv(t)
	foreignID, _ := e.foreignAccount(t, "account-scope-rbac-foreign")
	missingID := e.missingAccountID(t)
	role := testpkg.CreateTestRoleForTenant(t, e.tc.db, "account-scope-rbac", e.tenantID)

	for _, action := range []struct {
		method string
		path   func(int64) string
		body   any
	}{
		{http.MethodGet, func(accountID int64) string { return fmt.Sprintf("/auth/accounts/%d/roles", accountID) }, nil},
		{http.MethodPut, func(accountID int64) string { return fmt.Sprintf("/auth/accounts/%d/roles", accountID) }, map[string]string{"role_id": fmt.Sprintf("%d", role.ID)}},
	} {
		foreign := e.execute(t, e.claims, action.method, action.path(foreignID), action.body)
		missing := e.execute(t, e.claims, action.method, action.path(missingID), action.body)
		assert.Equal(t, http.StatusNotFound, foreign.Code, foreign.Body.String())
		assert.Equal(t, missing.Code, foreign.Code)
		assert.JSONEq(t, missing.Body.String(), foreign.Body.String())
	}
}

func TestAccountManagementForeignGetDoesNotLeakExistence(t *testing.T) {
	t.Parallel()
	e := newAccountIsolationEnv(t)
	foreignID, _ := e.foreignAccount(t, "account-scope-get-foreign")
	missingID := e.missingAccountID(t)
	ctx := tenant.WithTenantID(context.Background(), e.tenantID)

	_, foreignErr := e.tc.resource.Sessions.FindManageableAccount(ctx, foreignID)
	_, missingErr := e.tc.resource.Sessions.FindManageableAccount(ctx, missingID)
	require.ErrorIs(t, foreignErr, identityaccess.ErrAccountNotFound)
	require.ErrorIs(t, missingErr, identityaccess.ErrAccountNotFound)
	assert.Equal(t, missingErr.Error(), foreignErr.Error())
}

func TestAccountManagementForeignDeactivateDoesNotLeakExistence(t *testing.T) {
	t.Parallel()
	e := newAccountIsolationEnv(t)
	foreignID, _ := e.foreignAccount(t, "account-scope-deactivate-foreign")
	foreignErr := e.tc.resource.Sessions.DeactivateAccount(e.schoolCtx(), foreignID)
	missingErr := e.tc.resource.Sessions.DeactivateAccount(e.schoolCtx(), e.missingAccountID(t))
	require.ErrorIs(t, foreignErr, identityaccess.ErrAccountNotFound)
	require.ErrorIs(t, missingErr, identityaccess.ErrAccountNotFound)
	assert.Equal(t, missingErr.Error(), foreignErr.Error())
	assert.True(t, readStoredAccount(t, testpkg.Ctx(t), e.tc.db, foreignID).Active)
}

func TestAccountManagementInactiveMembershipDenied(t *testing.T) {
	t.Parallel()
	e := newAccountIsolationEnv(t)
	account := testpkg.CreateTestAccount(t, e.tc.db, "account-scope-inactive")
	_, err := e.tc.db.NewUpdate().TableExpr("auth.account_tenants").Set("status = 'inactive'").Where("account_id = ?", account.ID).Where("tenant_id = ?", e.tenantID).Exec(context.Background())
	require.NoError(t, err)

	ctx := tenant.WithTenantID(context.Background(), e.tenantID)
	_, err = e.tc.resource.Sessions.FindManageableAccount(ctx, account.ID)
	require.ErrorIs(t, err, identityaccess.ErrAccountNotFound)
	require.ErrorIs(t, e.tc.resource.Sessions.DeactivateAccount(e.schoolCtx(), account.ID), identityaccess.ErrAccountNotFound)
}

func (e *accountIsolationEnv) createSchoolInOwnOrganization(t *testing.T) (int64, int64) {
	t.Helper()
	var organizationID int64
	require.NoError(t, e.tc.db.NewSelect().Column("organization_id").TableExpr("platform.schools").Where("id = ?", e.tenantID).Scan(context.Background(), &organizationID))
	schoolID := testpkg.UniqueTestTenantID(t)
	token := fmt.Sprintf("account-scope-org-%d", schoolID)
	_, err := e.tc.db.ExecContext(context.Background(), `
		INSERT INTO platform.schools (id, organization_id, name, slug, subdomain, active, email)
		VALUES (?, ?, ?, ?, ?, true, ?)`, schoolID, organizationID, token, token, token, testpkg.TestSchoolEmail(token))
	require.NoError(t, err)
	return organizationID, schoolID
}

func TestAccountManagementPlatformScopeRemainsGlobal(t *testing.T) {
	t.Parallel()
	e := newAccountIsolationEnv(t)
	foreignID, _ := e.foreignAccount(t, "account-scope-platform")
	ctx := tenant.WithScope(context.Background(), tenant.ScopePlatform)

	got, err := e.tc.resource.Sessions.FindManageableAccount(ctx, foreignID)
	require.NoError(t, err)
	assert.Equal(t, foreignID, got.ID)
	require.NoError(t, e.tc.resource.Sessions.DeactivateAccount(ctx, foreignID))
	require.NoError(t, e.tc.resource.Sessions.ActivateAccount(ctx, foreignID))
}

// Organization scope must not detach a command from an existing school unit.
func TestAccountManagementOrganizationWritesRollBackWithCaller(t *testing.T) {
	t.Parallel()
	e := newAccountIsolationEnv(t)
	organizationID, _ := e.createSchoolInOwnOrganization(t)
	account := testpkg.CreateTestAccount(t, e.tc.db, "org-write-rollback")
	ctx := testpkg.WithTestTenantRuntime(t, tenant.WithScope(tenant.WithOrgID(testpkg.Ctx(t), organizationID), tenant.ScopeOrg))
	rollback := errors.New("later workflow command failed")
	err := testpkg.WithinCurrentTenant(ctx, func(txCtx context.Context) error {
		if err := e.tc.resource.Sessions.DeactivateAccount(txCtx, account.ID); err != nil {
			return err
		}
		return rollback
	})
	require.ErrorIs(t, err, rollback)
	got := readStoredAccount(t, ctx, e.tc.db, account.ID)
	assert.True(t, got.Active)
}

func TestOrganizationStaffOffboardingPreservesLockedCallerTransaction(t *testing.T) {
	t.Parallel()
	e := newAccountIsolationEnv(t)
	organizationID, _ := e.createSchoolInOwnOrganization(t)
	_, account := testpkg.CreateTestCalendarStaff(t, e.tc.db, "Organization", "Offboarding")
	testpkg.CreateTestToken(t, e.tc.db, account.ID, "refresh")
	access := setupAuthModuleOn(t, e.tc.db).Auth
	ctx := testpkg.WithTestTenantRuntime(t, tenant.WithScope(tenant.WithOrgID(testpkg.Ctx(t), organizationID), tenant.ScopeOrg))
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	preview, err := access.PreviewStaffOffboarding(ctx, account.ID)
	require.NoError(t, err)
	require.True(t, preview.DeactivateAccount)
	rollback := errors.New("later workflow command failed")
	err = testpkg.WithinCurrentTenant(ctx, func(txCtx context.Context) error {
		result, executeErr := access.ExecuteStaffOffboarding(txCtx, account.ID, preview.Revision)
		if executeErr != nil {
			return executeErr
		}
		require.True(t, result.AccountDeactivated)
		return rollback
	})
	require.ErrorIs(t, err, rollback)
	// Use a fresh context so a lock-wait timeout cannot mask the persisted state.
	got := readStoredAccount(t, testpkg.Ctx(t), e.tc.db, account.ID)
	require.True(t, got.Active)
	membership, err := e.tc.resource.Sessions.VerifyAccountTenantMembership(testpkg.Ctx(t), account.ID, e.tenantID)
	require.NoError(t, err)
	require.True(t, membership)
	result, err := access.ExecuteStaffOffboarding(ctx, account.ID, preview.Revision)
	require.NoError(t, err, "the rolled-back preview must still be executable")
	require.True(t, result.AccountDeactivated)
	require.EqualValues(t, 1, result.TokensRevoked)
	got = readStoredAccount(t, testpkg.Ctx(t), e.tc.db, account.ID)
	require.False(t, got.Active)
}

func TestAccountManagementOrganizationWriteRetainsCallerSchoolBoundary(t *testing.T) {
	t.Parallel()
	e := newAccountIsolationEnv(t)
	organizationID, schoolID := e.createSchoolInOwnOrganization(t)
	accountID, _ := e.accountForTenant(t, "org-school-boundary", schoolID)
	ctx := testpkg.WithTestTenantRuntime(t, tenant.WithScope(tenant.WithOrgID(testpkg.Ctx(t), organizationID), tenant.ScopeOrg))
	err := testpkg.WithinCurrentTenant(ctx, func(txCtx context.Context) error {
		return e.tc.resource.Sessions.DeactivateAccount(txCtx, accountID)
	})
	require.ErrorIs(t, err, identityaccess.ErrAccountNotFound)
	got := readStoredAccount(t, ctx, e.tc.db, accountID)
	require.True(t, got.Active)
}

// TestAccountManagementRejectsTraegerTokens: ADR 0084 removed the former org
// scope of the OGS portal. A Träger token (scope org) names no school and
// reaches no account, role or permission route, whatever rights it carries.
func TestAccountManagementRejectsTraegerTokens(t *testing.T) {
	t.Parallel()
	e := newAccountIsolationEnv(t)
	organizationID, schoolID := e.createSchoolInOwnOrganization(t)
	accountID, _ := e.accountForTenant(t, "account-scope-traeger", schoolID)
	claims := testutil.Claims{ID: e.claims.ID, Sub: e.claims.Sub, Roles: []string{"admin"}, Permissions: []string{"admin:*"},
		IsAdmin: true, Scope: tenant.ScopeOrg, OrgID: organizationID}
	for _, action := range []struct {
		method string
		path   string
		body   any
	}{
		{http.MethodGet, "/auth/permissions", nil},
		{http.MethodGet, fmt.Sprintf("/auth/accounts/%d/roles", accountID), nil},
	} {
		rr := e.execute(t, claims, action.method, action.path, action.body)
		assert.Equal(t, http.StatusUnauthorized, rr.Code, "%s %s: %s", action.method, action.path, rr.Body.String())
	}
}
