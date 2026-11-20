// Package active_test contains hermetic integration tests for the active API handlers.
// Each test creates its own fixtures and cleans up after itself.
package presence_test

import (
	"fmt"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"

	"github.com/moto-ogs/project-phoenix/api/testutil"
	"github.com/moto-ogs/project-phoenix/auth/authorize/permissions"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// ============================================================================
// UNCLAIMED GROUPS TESTS
// ============================================================================

func TestUnclaimedGroups_Integration(t *testing.T) {
	t.Parallel()
	tc, router := setupUnclaimedRouter(t)

	t.Run("claim group - requires JWT with staff context", func(t *testing.T) {
		// Create fixtures
		room := testpkg.CreateTestRoom(t, tc.db, fmt.Sprintf("Claim Room %d", time.Now().UnixNano()))
		activityGroup := testpkg.CreateTestActivityGroup(t, tc.db, fmt.Sprintf("Claim Activity %d", time.Now().UnixNano()))
		activeGroup := testpkg.CreateTestActiveGroup(t, tc.db, activityGroup.ID, room.ID)
		_, account := testpkg.CreateTestStaffWithAccount(t, tc.db, "Claim", "Staff")

		// Create claims with the account ID
		staffClaims := testutil.Claims{
			ID:          int(account.ID),
			TenantID:    testpkg.Tenant(t),
			Sub:         fmt.Sprintf("%d", account.ID),
			Roles:       []string{"staff"},
			Permissions: []string{permissions.GroupsUpdate},
		}

		req := testutil.NewJSONRequest(t, "POST", fmt.Sprintf("/active/groups/%d/claim", activeGroup.ID), nil)
		rr := testutil.ExecuteWithAuthPermissions(t, router, req, staffClaims, []string{permissions.GroupsUpdate})

		testutil.AssertSuccessResponse(t, rr, testutil.StatusOK)
	})
}

// ============================================================================
// ANALYTICS TESTS
// ============================================================================

func TestAnalytics_Integration(t *testing.T) {
	t.Parallel()
	_, router := setupAnalyticsRouter(t)
	adminClaims := testutil.AdminTestClaims(1)

	t.Run("get dashboard analytics", func(t *testing.T) {
		req := testutil.NewJSONRequest(t, "GET", "/active/analytics/dashboard", nil)
		rr := testutil.ExecuteWithAuthPermissions(t, router, req, adminClaims, []string{permissions.GroupsRead})

		testutil.AssertSuccessResponse(t, rr, testutil.StatusOK)
	})
}

// ============================================================================
// ACTIVE GROUPS TESTS
// ============================================================================

func TestActiveGroups_Integration(t *testing.T) {
	t.Parallel()
	tc, router := setupActiveGroupsRouter(t)
	adminClaims := testutil.AdminTestClaims(1)

	t.Run("list active groups", func(t *testing.T) {
		req := testutil.NewJSONRequest(t, "GET", "/active/groups", nil)
		rr := testutil.ExecuteWithAuthPermissions(t, router, req, adminClaims, []string{permissions.GroupsRead})

		testutil.AssertSuccessResponse(t, rr, testutil.StatusOK)
		response := testutil.ParseJSONResponse(t, rr.Body.Bytes())
		_, ok := response["data"].([]interface{})
		assert.True(t, ok, "Expected data to be an array")
	})

	t.Run("list active groups with active filter", func(t *testing.T) {
		req := testutil.NewJSONRequest(t, "GET", "/active/groups?active=true", nil)
		rr := testutil.ExecuteWithAuthPermissions(t, router, req, adminClaims, []string{permissions.GroupsRead})

		testutil.AssertSuccessResponse(t, rr, testutil.StatusOK)
	})

	t.Run("list active groups with inactive filter", func(t *testing.T) {
		req := testutil.NewJSONRequest(t, "GET", "/active/groups?active=false", nil)
		rr := testutil.ExecuteWithAuthPermissions(t, router, req, adminClaims, []string{permissions.GroupsRead})

		testutil.AssertSuccessResponse(t, rr, testutil.StatusOK)
	})

	t.Run("list active groups with is_active filter and relations", func(t *testing.T) {
		req := testutil.NewJSONRequest(t, "GET", "/active/groups?is_active=true", nil)
		rr := testutil.ExecuteWithAuthPermissions(t, router, req, adminClaims, []string{permissions.GroupsRead})

		testutil.AssertSuccessResponse(t, rr, testutil.StatusOK)
	})

	t.Run("get active group supervisors", func(t *testing.T) {
		room := testpkg.CreateTestRoom(t, tc.db, fmt.Sprintf("Supervisors Room %d", time.Now().UnixNano()))
		activityGroup := testpkg.CreateTestActivityGroup(t, tc.db, fmt.Sprintf("Supervisors Activity %d", time.Now().UnixNano()))
		activeGroup := testpkg.CreateTestActiveGroup(t, tc.db, activityGroup.ID, room.ID)

		req := testutil.NewJSONRequest(t, "GET", fmt.Sprintf("/active/groups/%d/supervisors", activeGroup.ID), nil)
		rr := testutil.ExecuteWithAuthPermissions(t, router, req, adminClaims, []string{permissions.GroupsRead})

		testutil.AssertSuccessResponse(t, rr, testutil.StatusOK)
	})

	t.Run("get active group supervisors invalid id", func(t *testing.T) {
		req := testutil.NewJSONRequest(t, "GET", "/active/groups/invalid/supervisors", nil)
		rr := testutil.ExecuteWithAuthPermissions(t, router, req, adminClaims, []string{permissions.GroupsRead})

		testutil.AssertBadRequest(t, rr)
	})

}

// ============================================================================
// VISITS CRUD TESTS
// ============================================================================

func TestVisits_Integration(t *testing.T) {
	t.Parallel()
	_, router := setupVisitsCRUDRouter(t)
	adminClaims := testutil.AdminTestClaims(1)

	t.Run("list visits", func(t *testing.T) {
		req := testutil.NewJSONRequest(t, "GET", "/active/visits", nil)
		rr := testutil.ExecuteWithAuthPermissions(t, router, req, adminClaims, []string{permissions.GroupsRead})

		testutil.AssertSuccessResponse(t, rr, testutil.StatusOK)
		response := testutil.ParseJSONResponse(t, rr.Body.Bytes())
		_, ok := response["data"].([]interface{})
		assert.True(t, ok, "Expected data to be an array")
	})

	t.Run("list visits with active filter", func(t *testing.T) {
		req := testutil.NewJSONRequest(t, "GET", "/active/visits?active=true", nil)
		rr := testutil.ExecuteWithAuthPermissions(t, router, req, adminClaims, []string{permissions.GroupsRead})

		testutil.AssertSuccessResponse(t, rr, testutil.StatusOK)
	})

	t.Run("list visits with inactive filter", func(t *testing.T) {
		req := testutil.NewJSONRequest(t, "GET", "/active/visits?active=false", nil)
		rr := testutil.ExecuteWithAuthPermissions(t, router, req, adminClaims, []string{permissions.GroupsRead})

		testutil.AssertSuccessResponse(t, rr, testutil.StatusOK)
	})

}

// ============================================================================
// SUPERVISORS CRUD TESTS
// ============================================================================

func TestSupervisors_Integration(t *testing.T) {
	t.Parallel()
	tc, router := setupSupervisorsCRUDRouter(t)
	adminClaims := testutil.AdminTestClaims(1)

	t.Run("get staff active supervisions", func(t *testing.T) {
		room := testpkg.CreateTestRoom(t, tc.db, fmt.Sprintf("Staff Active Room %d", time.Now().UnixNano()))
		activityGroup := testpkg.CreateTestActivityGroup(t, tc.db, fmt.Sprintf("Staff Active Activity %d", time.Now().UnixNano()))
		activeGroup := testpkg.CreateTestActiveGroup(t, tc.db, activityGroup.ID, room.ID)
		staff := testpkg.CreateTestStaff(t, tc.db, "StaffActive", "Staff")
		_ = testpkg.CreateTestGroupSupervisor(t, tc.db, staff.ID, activeGroup.ID, "supervisor")

		req := testutil.NewJSONRequest(t, "GET", fmt.Sprintf("/active/supervisors/staff/%d/active", staff.ID), nil)
		rr := testutil.ExecuteWithAuthPermissions(t, router, req, adminClaims, []string{permissions.GroupsRead})

		testutil.AssertSuccessResponse(t, rr, testutil.StatusOK)
	})

	t.Run("get staff active supervisions invalid id", func(t *testing.T) {
		req := testutil.NewJSONRequest(t, "GET", "/active/supervisors/staff/invalid/active", nil)
		rr := testutil.ExecuteWithAuthPermissions(t, router, req, adminClaims, []string{permissions.GroupsRead})

		testutil.AssertBadRequest(t, rr)
	})

	t.Run("end supervision", func(t *testing.T) {
		room := testpkg.CreateTestRoom(t, tc.db, fmt.Sprintf("End Supervision Room %d", time.Now().UnixNano()))
		activityGroup := testpkg.CreateTestActivityGroup(t, tc.db, fmt.Sprintf("End Supervision Activity %d", time.Now().UnixNano()))
		activeGroup := testpkg.CreateTestActiveGroup(t, tc.db, activityGroup.ID, room.ID)
		staff := testpkg.CreateTestStaff(t, tc.db, "EndSupervision", "Staff")
		supervisor := testpkg.CreateTestGroupSupervisor(t, tc.db, staff.ID, activeGroup.ID, "supervisor")

		req := testutil.NewJSONRequest(t, "POST", fmt.Sprintf("/active/supervisors/%d/end", supervisor.ID), nil)
		rr := testutil.ExecuteWithAuthPermissions(t, router, req, adminClaims, []string{permissions.GroupsUpdate})

		testutil.AssertSuccessResponse(t, rr, testutil.StatusOK)
	})

	t.Run("end supervision invalid id", func(t *testing.T) {
		req := testutil.NewJSONRequest(t, "POST", "/active/supervisors/invalid/end", nil)
		rr := testutil.ExecuteWithAuthPermissions(t, router, req, adminClaims, []string{permissions.GroupsUpdate})

		testutil.AssertBadRequest(t, rr)
	})
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

func setupUnclaimedRouter(t *testing.T) (*testContext, testutil.Router) {
	t.Helper()
	tc := setupActiveRoute(t)
	return tc, mountActiveRouter(tc)
}

func setupAnalyticsRouter(t *testing.T) (*testContext, testutil.Router) {
	t.Helper()
	tc := setupActiveRoute(t)
	return tc, mountActiveRouter(tc)
}

func setupActiveGroupsRouter(t *testing.T) (*testContext, testutil.Router) {
	t.Helper()
	tc := setupActiveRoute(t)
	return tc, mountActiveRouter(tc)
}

func setupVisitsCRUDRouter(t *testing.T) (*testContext, testutil.Router) {
	t.Helper()
	tc := setupActiveRoute(t)
	return tc, mountActiveRouter(tc)
}

func setupSupervisorsCRUDRouter(t *testing.T) (*testContext, testutil.Router) {
	t.Helper()
	tc := setupActiveRoute(t)
	return tc, mountActiveRouter(tc)
}
