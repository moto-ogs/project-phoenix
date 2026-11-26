package httpadapter_test

import (
	"fmt"
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/api/testutil"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// System protection follows the persisted flag, not a name a school happens
// to use for its own activity (#8130).
func TestSystemActivityProtectionUsesPersistedFlag(t *testing.T) {
	t.Parallel()
	ctx := setupActivitiesRoute(t)

	systemActivity := testpkg.CreateTestActivityGroup(t, ctx.db, "WC")
	markGroupAsSystem(t, ctx.db, systemActivity.ID)
	regularActivity := testpkg.CreateTestActivityGroup(t, ctx.db, "WC")
	otherCategory := testpkg.CreateTestActivityCategory(t, ctx.db, "Andere Kategorie")

	systemUpdate := testutil.ExecuteWithAuth(t, ctx.router, testutil.NewAuthenticatedRequest(t, http.MethodPut, fmt.Sprintf("/activities/%d", systemActivity.ID), map[string]any{
		"name": "Umbenannt", "max_participants": 4,
		"category_id":      fmt.Sprint(systemActivity.CategoryID),
		"expected_version": activityVersion(t, ctx, systemActivity.ID),
	}), testutil.DefaultTestClaims())
	assert.Equal(t, http.StatusForbidden, systemUpdate.Code, systemUpdate.Body.String())
	assert.Equal(t, "timetable.activity_system_protected", testutil.ParseJSONResponse(t, systemUpdate.Body.Bytes())["code"])

	systemDelete := testutil.ExecuteWithAuth(t, ctx.router, testutil.NewAuthenticatedRequest(t, http.MethodDelete, fmt.Sprintf("/activities/%d", systemActivity.ID), nil), testutil.DefaultTestClaims())
	assert.Equal(t, http.StatusForbidden, systemDelete.Code, systemDelete.Body.String())

	regularUpdate := testutil.ExecuteWithAuth(t, ctx.router, testutil.NewAuthenticatedRequest(t, http.MethodPut, fmt.Sprintf("/activities/%d", regularActivity.ID), map[string]any{
		"name": "Eigene Pausen-AG", "max_participants": 4,
		"category_id":      fmt.Sprint(otherCategory.ID),
		"expected_version": activityVersion(t, ctx, regularActivity.ID),
	}), testutil.DefaultTestClaims())
	testutil.AssertSuccessResponse(t, regularUpdate, http.StatusOK)

	regularDelete := testutil.ExecuteWithAuth(t, ctx.router, testutil.NewAuthenticatedRequest(t, http.MethodDelete, fmt.Sprintf("/activities/%d", regularActivity.ID), nil), testutil.DefaultTestClaims())
	require.Equal(t, http.StatusOK, regularDelete.Code, regularDelete.Body.String())
}
