// Package active_test tests the active API handlers with hermetic test pattern.
//
// These tests verify HTTP request/response handling, status codes, and error responses.
// They use real services with a test database (no mocks).
package presence_test

import (
	"context"
	"fmt"
	"log/slog"
	"testing"
	"time"

	rootAPI "github.com/moto-ogs/project-phoenix/api"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/api/testutil"
	"github.com/moto-ogs/project-phoenix/auth/authorize/permissions"
	tenantsettings "github.com/moto-ogs/project-phoenix/modules/settings"
	presenceAPI "github.com/moto-ogs/project-phoenix/modules/studentpresence/inbound/presence"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// testContext holds shared test resources
type testContext struct {
	db       *testpkg.DB
	resource *presenceAPI.Resource
	settings testSettingsWriter
}

type testSettingsWriter struct {
	SetString  func(context.Context, string, string, *int64, []string) error
	SetBool    func(context.Context, string, bool, *int64, []string) error
	ResetValue func(context.Context, string, *int64, []string) error
}

// setupActiveRoute creates test resources for active handler tests
func setupActiveRoute(t *testing.T, settingReaders ...presenceAPI.Settings) *testContext {
	t.Helper()

	db, svc, svcPresence, svcPeople, _, svcCaller, svcCare := setupActiveModule(t)
	var settingsReader presenceAPI.Settings = svc.Settings
	if len(settingReaders) > 0 {
		settingsReader = settingReaders[0]
	}
	resource := presenceAPI.NewResource(svcPresence.PresenceOperations(), activePeople{source: svcPeople.AttendancePeople()}, activeStaffAccess{source: rootAPI.NewActiveTestAttendanceStaff(svcCaller)}, settingsReader, rootAPI.ProtectedTenantRoutes, slog.Default(), testPresenceQueries(t, db), requestRuntimeForTest(svcCare.WithAttendanceStaff), authorizationForTest(), tenantsettings.NewDisplaySettings(settingsReader))

	return &testContext{
		db:       db,
		resource: resource,
		settings: testSettingsWriter{
			SetString: func(ctx context.Context, key, value string, actor *int64, permissions []string) error {
				return svc.Settings.SetValue(ctx, key, value, actor, permissions)
			},
			SetBool: func(ctx context.Context, key string, value bool, actor *int64, permissions []string) error {
				return svc.Settings.SetValue(ctx, key, value, actor, permissions)
			},
			ResetValue: svc.Settings.ResetValue,
		},
	}
}

// mountActiveRouter mounts the resource's production Router() under /active so
// tests exercise the real middleware chain (Verifier -> Authenticator ->
// TenantScopeMiddleware -> RequiresPermission/resource-auth -> TenantTxMiddleware)
// exactly as the running server does, instead of a hand-wired stand-in.
//
// The request-scoped identity memo (#2099) is part of that chain: api/base.go
// mounts it router-wide. Without it here, a handler that resolves the caller
// more than once looks more expensive in a query-budget test than it is in
// production — which is the wrong number to hold a budget against.
func mountActiveRouter(tc *testContext) testutil.Router {
	r := testutil.NewRouter()
	r.Use(rootAPI.RequestIdentityCacheMiddleware)
	r.Mount("/active", tc.resource.Router())
	return r
}

// setupProtectedRouter builds the production router mounted at /active.
func setupProtectedRouter(t *testing.T) (*testContext, testutil.Router) {
	t.Helper()
	tc := setupActiveRoute(t)
	return tc, mountActiveRouter(tc)
}

// setupExtendedProtectedRouter is an alias for setupProtectedRouter kept for the
// tests written against a larger hand-wired router; the production Router()
// already exposes every one of those endpoints.
func setupExtendedProtectedRouter(t *testing.T) (*testContext, testutil.Router) {
	t.Helper()
	tc := setupActiveRoute(t)
	return tc, mountActiveRouter(tc)
}

// ============================================================================
// ACTIVE GROUP TESTS
// ============================================================================

func TestListActiveGroups(t *testing.T) {
	t.Parallel()
	_, router := setupProtectedRouter(t)

	adminClaims := testutil.AdminTestClaims(1)

	t.Run("success with permission", func(t *testing.T) {
		req := testutil.NewJSONRequest(t, "GET", "/active/groups", nil)
		rr := testutil.ExecuteWithAuthPermissions(t, router, req, adminClaims, []string{permissions.GroupsRead})

		testutil.AssertSuccessResponse(t, rr, testutil.StatusOK)

		response := testutil.ParseJSONResponse(t, rr.Body.Bytes())
		data, ok := response["data"].([]interface{})
		require.True(t, ok, "Expected data to be an array")
		assert.NotNil(t, data, "Expected data array")
	})

	t.Run("forbidden without permission", func(t *testing.T) {
		req := testutil.NewJSONRequest(t, "GET", "/active/groups", nil)
		rr := testutil.ExecuteWithAuthPermissions(t, router, req, adminClaims, []string{})

		testutil.AssertForbidden(t, rr)
	})

	t.Run("success with active filter", func(t *testing.T) {
		req := testutil.NewJSONRequest(t, "GET", "/active/groups?active=true", nil)
		rr := testutil.ExecuteWithAuthPermissions(t, router, req, adminClaims, []string{permissions.GroupsRead})

		testutil.AssertSuccessResponse(t, rr, testutil.StatusOK)
	})
}

// ============================================================================
// VISIT TESTS
// ============================================================================

func TestListVisits(t *testing.T) {
	t.Parallel()
	_, router := setupProtectedRouter(t)

	adminClaims := testutil.AdminTestClaims(1)

	t.Run("success with permission", func(t *testing.T) {
		req := testutil.NewJSONRequest(t, "GET", "/active/visits", nil)
		rr := testutil.ExecuteWithAuthPermissions(t, router, req, adminClaims, []string{permissions.GroupsRead})

		testutil.AssertSuccessResponse(t, rr, testutil.StatusOK)

		response := testutil.ParseJSONResponse(t, rr.Body.Bytes())
		data, ok := response["data"].([]interface{})
		require.True(t, ok, "Expected data to be an array")
		assert.NotNil(t, data, "Expected data array")
	})

	t.Run("success with active filter", func(t *testing.T) {
		req := testutil.NewJSONRequest(t, "GET", "/active/visits?active=true", nil)
		rr := testutil.ExecuteWithAuthPermissions(t, router, req, adminClaims, []string{permissions.GroupsRead})

		testutil.AssertSuccessResponse(t, rr, testutil.StatusOK)
	})

	t.Run("rejects an invalid active group filter without a success response", func(t *testing.T) {
		req := testutil.NewJSONRequest(t, "GET", "/active/visits?active_group_ids=invalid", nil)
		rr := testutil.ExecuteWithAuthPermissions(t, router, req, adminClaims, []string{permissions.GroupsRead})

		testutil.AssertBadRequest(t, rr)
		assert.NotContains(t, rr.Body.String(), "Visits retrieved successfully")
	})

	t.Run("forbidden without permission", func(t *testing.T) {
		req := testutil.NewJSONRequest(t, "GET", "/active/visits", nil)
		rr := testutil.ExecuteWithAuthPermissions(t, router, req, adminClaims, []string{})

		testutil.AssertForbidden(t, rr)
	})
}

// ============================================================================
// SUPERVISOR TESTS
// ============================================================================

func TestGetStaffActiveSupervisions(t *testing.T) {
	t.Parallel()
	tc, router := setupProtectedRouter(t)

	adminClaims := testutil.AdminTestClaims(1)

	// Create test staff
	staff := testpkg.CreateTestStaff(t, tc.db, "Active", "Supervisions")

	t.Run("success returns empty array when no supervisions", func(t *testing.T) {
		req := testutil.NewJSONRequest(t, "GET", fmt.Sprintf("/active/supervisors/staff/%d/active", staff.ID), nil)
		rr := testutil.ExecuteWithAuthPermissions(t, router, req, adminClaims, []string{permissions.GroupsRead})

		testutil.AssertSuccessResponse(t, rr, testutil.StatusOK)

		response := testutil.ParseJSONResponse(t, rr.Body.Bytes())
		data, ok := response["data"].([]interface{})
		require.True(t, ok, "Expected data to be an array")
		assert.Empty(t, data, "Expected empty array")
	})

	t.Run("bad request with invalid staff id", func(t *testing.T) {
		req := testutil.NewJSONRequest(t, "GET", "/active/supervisors/staff/invalid/active", nil)
		rr := testutil.ExecuteWithAuthPermissions(t, router, req, adminClaims, []string{permissions.GroupsRead})

		testutil.AssertBadRequest(t, rr)
	})
}

// ============================================================================
// ANALYTICS TESTS
// ============================================================================

func TestGetDashboardAnalytics(t *testing.T) {
	t.Parallel()
	_, router := setupProtectedRouter(t)

	adminClaims := testutil.AdminTestClaims(1)

	t.Run("success with permission", func(t *testing.T) {
		req := testutil.NewJSONRequest(t, "GET", "/active/analytics/dashboard", nil)
		rr := testutil.ExecuteWithAuthPermissions(t, router, req, adminClaims, []string{permissions.GroupsRead})

		testutil.AssertSuccessResponse(t, rr, testutil.StatusOK)

		response := testutil.ParseJSONResponse(t, rr.Body.Bytes())
		data, ok := response["data"].(map[string]interface{})
		require.True(t, ok, "Expected data to be an object")
		assert.Contains(t, data, "students_present")
		assert.Contains(t, data, "active_activities")
		assert.Contains(t, data, "last_updated")
	})

	t.Run("forbidden without permission", func(t *testing.T) {
		req := testutil.NewJSONRequest(t, "GET", "/active/analytics/dashboard", nil)
		rr := testutil.ExecuteWithAuthPermissions(t, router, req, adminClaims, []string{})

		testutil.AssertForbidden(t, rr)
	})
}

// ============================================================================
// DELETE/UPDATE TESTS
// ============================================================================

// ============================================================================
// EXTENDED VISIT TESTS
// ============================================================================

// ============================================================================
// EXTENDED SUPERVISOR TESTS
// ============================================================================

func TestEndSupervision(t *testing.T) {
	t.Parallel()
	tc, router := setupProtectedRouter(t)

	adminClaims := testutil.AdminTestClaims(1)

	t.Run("not found with invalid id", func(t *testing.T) {
		req := testutil.NewJSONRequest(t, "POST", "/active/supervisors/99999/end", nil)
		rr := testutil.ExecuteWithAuthPermissions(t, router, req, adminClaims, []string{permissions.GroupsUpdate})

		testutil.AssertNotFound(t, rr)
	})

	t.Run("forbidden without permission", func(t *testing.T) {
		req := testutil.NewJSONRequest(t, "POST", "/active/supervisors/1/end", nil)
		rr := testutil.ExecuteWithAuthPermissions(t, router, req, adminClaims, []string{permissions.GroupsRead})

		testutil.AssertForbidden(t, rr)
	})

	t.Run("success ending supervision", func(t *testing.T) {
		room := testpkg.CreateTestRoom(t, tc.db, fmt.Sprintf("End Supervision Room %d", time.Now().UnixNano()))
		group := testpkg.CreateTestActivityGroup(t, tc.db, fmt.Sprintf("End Supervision Activity %d", time.Now().UnixNano()))
		activeGroup := testpkg.CreateTestActiveGroup(t, tc.db, group.ID, room.ID)
		staff := testpkg.CreateTestStaff(t, tc.db, "End", "Supervision")
		supervisor := testpkg.CreateTestGroupSupervisor(t, tc.db, staff.ID, activeGroup.ID, "to-end")

		req := testutil.NewJSONRequest(t, "POST", fmt.Sprintf("/active/supervisors/%d/end", supervisor.ID), nil)
		rr := testutil.ExecuteWithAuthPermissions(t, router, req, adminClaims, []string{permissions.GroupsUpdate})

		testutil.AssertSuccessResponse(t, rr, testutil.StatusOK)
	})
}

// ============================================================================
// COMBINED GROUP TESTS
// ============================================================================

// ============================================================================
// ADDITIONAL TESTS FOR COVERAGE
// ============================================================================

func TestGetActiveGroupSupervisors(t *testing.T) {
	t.Parallel()
	tc, router := setupExtendedProtectedRouter(t)

	adminClaims := testutil.AdminTestClaims(1)

	t.Run("success with valid active group id", func(t *testing.T) {
		room := testpkg.CreateTestRoom(t, tc.db, fmt.Sprintf("GroupSupervisors Room %d", time.Now().UnixNano()))
		group := testpkg.CreateTestActivityGroup(t, tc.db, fmt.Sprintf("GroupSupervisors Activity %d", time.Now().UnixNano()))
		activeGroup := testpkg.CreateTestActiveGroup(t, tc.db, group.ID, room.ID)

		req := testutil.NewJSONRequest(t, "GET", fmt.Sprintf("/active/groups/%d/supervisors", activeGroup.ID), nil)
		rr := testutil.ExecuteWithAuthPermissions(t, router, req, adminClaims, []string{permissions.GroupsRead})

		testutil.AssertSuccessResponse(t, rr, testutil.StatusOK)
	})

	t.Run("not found with invalid group id", func(t *testing.T) {
		req := testutil.NewJSONRequest(t, "GET", "/active/groups/99999/supervisors", nil)
		rr := testutil.ExecuteWithAuthPermissions(t, router, req, adminClaims, []string{permissions.GroupsRead})

		assert.Equal(t, testutil.StatusNotFound, rr.Code, rr.Body.String())
	})

	t.Run("bad request with invalid group id format", func(t *testing.T) {
		req := testutil.NewJSONRequest(t, "GET", "/active/groups/invalid/supervisors", nil)
		rr := testutil.ExecuteWithAuthPermissions(t, router, req, adminClaims, []string{permissions.GroupsRead})

		testutil.AssertBadRequest(t, rr)
	})
}

func TestGetStaffActiveSupervisionsSuccess(t *testing.T) {
	t.Parallel()
	tc, router := setupExtendedProtectedRouter(t)

	adminClaims := testutil.AdminTestClaims(1)

	t.Run("success with active supervisions", func(t *testing.T) {
		room := testpkg.CreateTestRoom(t, tc.db, fmt.Sprintf("Staff Active Sup Room %d", time.Now().UnixNano()))
		group := testpkg.CreateTestActivityGroup(t, tc.db, fmt.Sprintf("Staff Active Sup Activity %d", time.Now().UnixNano()))
		activeGroup := testpkg.CreateTestActiveGroup(t, tc.db, group.ID, room.ID)
		staff := testpkg.CreateTestStaff(t, tc.db, "Staff", "ActiveSup")
		_ = testpkg.CreateTestGroupSupervisor(t, tc.db, staff.ID, activeGroup.ID, "active-role")

		req := testutil.NewJSONRequest(t, "GET", fmt.Sprintf("/active/supervisors/staff/%d/active", staff.ID), nil)
		rr := testutil.ExecuteWithAuthPermissions(t, router, req, adminClaims, []string{permissions.GroupsRead})

		testutil.AssertSuccessResponse(t, rr, testutil.StatusOK)
	})
}

// =============================================================================
// ROUTER TESTS
// =============================================================================

func TestRouter_ReturnsValidRouter(t *testing.T) {
	t.Parallel()
	tc := setupActiveRoute(t)
	router := tc.resource.Router()
	require.NotNil(t, router, "Router should return a valid testutil.Router")
}

// =============================================================================
// COMBINED GROUPS ADDITIONAL TESTS
// =============================================================================

// =============================================================================
// CREATE VISIT ADDITIONAL TESTS
// =============================================================================

// =============================================================================
// UPDATE COMBINED GROUP TESTS
// =============================================================================

// =============================================================================
// CREATE VISIT ADDITIONAL TESTS (26.7% coverage)
// =============================================================================

// ============================================================================
// ADDITIONAL COVERAGE TESTS - Previously 0% Coverage Handlers
// ============================================================================

// setupFullCoverageRouter builds the production router mounted at /active; it
// previously hand-wired the endpoints that had 0% coverage, all of which the
// production Router() exposes.
func setupFullCoverageRouter(t *testing.T) (*testContext, testutil.Router) {
	t.Helper()
	tc := setupActiveRoute(t)
	return tc, mountActiveRouter(tc)
}

func TestClaimGroup(t *testing.T) {
	t.Parallel()
	tc, router := setupFullCoverageRouter(t)

	// Create staff with account for claims
	_, staffAccount := testpkg.CreateTestStaffWithAccount(t, tc.db, "Claim", "Staff")

	staffClaims := testutil.Claims{
		ID:          int(staffAccount.ID),
		TenantID:    testpkg.Tenant(t),
		Sub:         "claim@example.com",
		Roles:       []string{"staff"},
		Permissions: []string{permissions.GroupsUpdate},
	}

	// Create test fixtures
	room := testpkg.CreateTestRoom(t, tc.db, fmt.Sprintf("ClaimRoom %d", time.Now().UnixNano()))
	group := testpkg.CreateTestActivityGroup(t, tc.db, fmt.Sprintf("ClaimGroup %d", time.Now().UnixNano()))
	activeGroup := testpkg.CreateTestActiveGroup(t, tc.db, group.ID, room.ID)

	t.Run("success claiming group", func(t *testing.T) {
		req := testutil.NewJSONRequest(t, "POST", fmt.Sprintf("/active/groups/%d/claim", activeGroup.ID), nil)
		rr := testutil.ExecuteWithAuthPermissions(t, router, req, staffClaims, []string{permissions.GroupsUpdate})

		testutil.AssertSuccessResponse(t, rr, testutil.StatusOK)
	})

	t.Run("error with non-existent group id", func(t *testing.T) {
		req := testutil.NewJSONRequest(t, "POST", "/active/groups/99999/claim", nil)
		rr := testutil.ExecuteWithAuthPermissions(t, router, req, staffClaims, []string{permissions.GroupsUpdate})

		assert.Equal(t, testutil.StatusNotFound, rr.Code, rr.Body.String())
	})

	t.Run("bad request with invalid id format", func(t *testing.T) {
		req := testutil.NewJSONRequest(t, "POST", "/active/groups/invalid/claim", nil)
		rr := testutil.ExecuteWithAuthPermissions(t, router, req, staffClaims, []string{permissions.GroupsUpdate})

		testutil.AssertBadRequest(t, rr)
	})

	t.Run("forbidden without permission", func(t *testing.T) {
		req := testutil.NewJSONRequest(t, "POST", fmt.Sprintf("/active/groups/%d/claim", activeGroup.ID), nil)
		rr := testutil.ExecuteWithAuthPermissions(t, router, req, staffClaims, []string{})

		testutil.AssertForbidden(t, rr)
	})
}

// ============================================================================
// ADMIN SUPERVISION OVERVIEW TESTS (GET /active/supervisors/all)
// ============================================================================

func TestGetAllActiveSupervisions(t *testing.T) {
	t.Parallel()
	_, router := setupProtectedRouter(t)

	adminClaims := testutil.AdminTestClaims(1)
	teacherClaims := testutil.TeacherTestClaims(42)

	t.Run("forbidden for non-admin user", func(t *testing.T) {
		req := testutil.NewJSONRequest(t, "GET", "/active/supervisors/all", nil)
		rr := testutil.ExecuteWithAuthPermissions(t, router, req, teacherClaims, []string{permissions.GroupsRead})

		testutil.AssertForbidden(t, rr)
	})

	t.Run("allowed for admin with the whole-team default", func(t *testing.T) {
		req := testutil.NewJSONRequest(t, "GET", "/active/supervisors/all", nil)
		rr := testutil.ExecuteWithAuthPermissions(t, router, req, adminClaims, []string{permissions.GroupsRead})

		assert.Equal(t, testutil.StatusOK, rr.Code, "body: %s", rr.Body.String())
	})

	t.Run("forbidden without groups:read permission", func(t *testing.T) {
		req := testutil.NewJSONRequest(t, "GET", "/active/supervisors/all", nil)
		rr := testutil.ExecuteWithAuthPermissions(t, router, req, adminClaims, []string{})

		testutil.AssertForbidden(t, rr)
	})
}
