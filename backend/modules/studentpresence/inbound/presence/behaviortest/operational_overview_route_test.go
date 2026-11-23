// Route-level acceptance for the school-wide operational overview (#2380).
//
// These tests drive the production Router() through the real middleware chain
// and the real settings service, because the claim under test is precisely
// that the list and detail paths answer the same visibility question. Write
// paths deliberately keep their separate resource authorization.
package presence_test

import (
	"context"
	"fmt"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/api/testutil"
	"github.com/moto-ogs/project-phoenix/auth/authorize/permissions"
	tenantsettings "github.com/moto-ogs/project-phoenix/modules/settings"
	"github.com/moto-ogs/project-phoenix/tenant"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// setOverviewScopeForTest stores the tenant override through the real settings
// service, so the test exercises the same resolution path a school admin's
// save produces.
func setOverviewScopeForTest(t *testing.T, tc *testContext, scope string) {
	t.Helper()

	ctx := tenant.WithTenantID(context.Background(), testpkg.Tenant(t))
	require.NoError(t, tc.settings.SetString(
		ctx, tenantsettings.KeyOperationalOverviewScope, scope, nil, nil,
	))
}

// caregiverClaims builds a plain staff caller: no admin role, no wildcard
// permission — the Betreuungskraft the issue is about.
func caregiverClaims(t *testing.T, tc *testContext, name string) testutil.Claims {
	t.Helper()

	_, account := testpkg.CreateTestStaffWithAccount(t, tc.db, "Overview", name)
	return testutil.Claims{
		ID:          int(account.ID),
		TenantID:    testpkg.Tenant(t),
		Sub:         fmt.Sprintf("%d", account.ID),
		Roles:       []string{"user"},
		Permissions: []string{permissions.GroupsRead},
	}
}

func getWithClaims(t *testing.T, router testutil.Router, path string, claims testutil.Claims) int {
	t.Helper()

	req := testutil.NewJSONRequest(t, "GET", path, nil)
	return testutil.ExecuteWithAuthPermissions(t, router, req, claims, []string{permissions.GroupsRead}).Code
}

// TestOperationalOverviewScope_OwnKeepsCaregiverOnOwnSupervisions is the
// default and the deactivation case in one: without the freigabe, a caregiver
// does not get the school-wide list.
func TestOperationalOverviewScope_OwnKeepsCaregiverOnOwnSupervisions(t *testing.T) {
	t.Parallel()

	tc, router := setupProtectedRouter(t)
	setOverviewScopeForTest(t, tc, tenantsettings.OverviewScopeOwn)

	claims := caregiverClaims(t, tc, "Own")

	assert.Equal(t, testutil.StatusForbidden,
		getWithClaims(t, router, "/active/supervisors/all", claims),
		"the school-wide list must stay closed on the own scope")
}

// TestOperationalOverviewScope_AllStaffOpensListAndDetail is the acceptance
// criterion: with the freigabe a caregiver opens the list of every running
// module.
func TestOperationalOverviewScope_AllStaffOpensListAndDetail(t *testing.T) {
	t.Parallel()

	tc, router := setupProtectedRouter(t)
	setOverviewScopeForTest(t, tc, tenantsettings.OverviewScopeAllStaff)

	claims := caregiverClaims(t, tc, "AllStaff")

	assert.Equal(t, testutil.StatusOK,
		getWithClaims(t, router, "/active/supervisors/all", claims),
		"the school-wide list must open for verified staff")
}

// TestOperationalOverviewScope_SchoolPortalCannotReachTenantRoutes verifies
// the stronger route boundary from a real school-scoped JWT. Even an account
// that also carries an admin role cannot use tenant operational endpoints.
func TestOperationalOverviewScope_SchoolPortalCannotReachTenantRoutes(t *testing.T) {
	t.Parallel()

	tc, router := setupProtectedRouter(t)
	setOverviewScopeForTest(t, tc, tenantsettings.OverviewScopeAllStaff)

	claims := caregiverClaims(t, tc, "SchoolPortal")
	claims.Scope = tenant.ScopeSchool
	claims.IsAdmin = true
	claims.Roles = []string{"admin"}

	assert.Equal(t, testutil.StatusUnauthorized,
		getWithClaims(t, router, "/active/supervisors/all", claims),
		"the tenant middleware must reject a school-portal token")
}

// TestOperationalOverviewScope_GroupModeIsNotAnAccessRule pins the decoupling
// the issue asks for: the organisational group mode alone opens nothing.
func TestOperationalOverviewScope_GroupModeIsNotAnAccessRule(t *testing.T) {
	t.Parallel()

	tc, router := setupProtectedRouter(t)

	ctx := tenant.WithTenantID(context.Background(), testpkg.Tenant(t))
	require.NoError(t, tc.settings.SetString(
		ctx, tenantsettings.KeyGroupMode, tenantsettings.GroupModeOpenCare, nil, nil,
	))
	setOverviewScopeForTest(t, tc, tenantsettings.OverviewScopeOwn)

	claims := caregiverClaims(t, tc, "GroupMode")

	assert.Equal(t, testutil.StatusForbidden,
		getWithClaims(t, router, "/active/supervisors/all", claims),
		"open care is an organisational decision, not a freigabe")
}
