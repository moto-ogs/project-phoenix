package httpadapter_test

import (
	"fmt"
	"net/http"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/api/testutil"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// A system activity keeps the category moto gave it, as it keeps its name;
// its other master data stays editable.
func TestUpdateSystemActivity_KeepsItsCategory(t *testing.T) {
	t.Parallel()
	ctx := setupActivitiesRoute(t)

	activity := testpkg.CreateTestActivityGroup(t, ctx.db, "WC")
	markGroupAsSystem(t, ctx.db, activity.ID)
	other := testpkg.CreateTestActivityCategory(t, ctx.db, fmt.Sprintf("Sport-%d", time.Now().UnixNano()))
	path := fmt.Sprintf("/activities/%d", activity.ID)

	moved := testutil.ExecuteWithAuth(t, ctx.router, testutil.NewAuthenticatedRequest(t, http.MethodPut, path, map[string]any{
		"name": "WC", "max_participants": 4,
		"category_id":      fmt.Sprint(other.ID),
		"expected_version": activityVersion(t, ctx, activity.ID),
	}), testutil.DefaultTestClaims())
	assert.Equal(t, http.StatusForbidden, moved.Code, moved.Body.String())
	assert.Equal(t, "timetable.activity_system_protected", testutil.ParseJSONResponse(t, moved.Body.Bytes())["code"])

	var storedCategory int64
	require.NoError(t, ctx.db.NewRaw(
		`SELECT category_id FROM activities.groups WHERE id = ?`, activity.ID,
	).Scan(testpkg.Ctx(t), &storedCategory))
	assert.Equal(t, activity.CategoryID, storedCategory)

	kept := testutil.ExecuteWithAuth(t, ctx.router, testutil.NewAuthenticatedRequest(t, http.MethodPut, path, map[string]any{
		"name": "WC", "max_participants": 4,
		"category_id":      fmt.Sprint(activity.CategoryID),
		"expected_version": activityVersion(t, ctx, activity.ID),
	}), testutil.DefaultTestClaims())
	testutil.AssertSuccessResponse(t, kept, http.StatusOK)
}
