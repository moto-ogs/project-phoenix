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

// moveActivityCategory asks to move the activity into category and returns
// the answer.
func moveActivityCategory(t *testing.T, ctx *testContext, activityID, categoryID int64) *http.Response {
	t.Helper()
	recorder := testutil.ExecuteWithAuth(t, ctx.router, testutil.NewAuthenticatedRequest(t, http.MethodPut, fmt.Sprintf("/activities/%d", activityID), map[string]any{
		"name": "WC", "max_participants": 4,
		"category_id":      fmt.Sprint(categoryID),
		"expected_version": activityVersion(t, ctx, activityID),
	}), testutil.DefaultTestClaims())
	return recorder.Result()
}

// A system activity keeps the category moto gave it, as it keeps its name,
// and cannot be deleted; its other master data stays editable. The flag
// decides, not the name (#8130).
func TestUpdateSystemActivity_KeepsItsCategory(t *testing.T) {
	t.Parallel()
	ctx := setupActivitiesRoute(t)

	activity := testpkg.CreateTestActivityGroup(t, ctx.db, "WC")
	markGroupAsSystem(t, ctx.db, activity.ID)
	other := testpkg.CreateTestActivityCategory(t, ctx.db, fmt.Sprintf("Sport-%d", time.Now().UnixNano()))
	assert.Equal(t, true, activityDetail(t, ctx, activity.ID)["is_system"])

	moved := testutil.ExecuteWithAuth(t, ctx.router, testutil.NewAuthenticatedRequest(t, http.MethodPut, fmt.Sprintf("/activities/%d", activity.ID), map[string]any{
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

	kept := moveActivityCategory(t, ctx, activity.ID, activity.CategoryID)
	defer func() { _ = kept.Body.Close() }()
	assert.Equal(t, http.StatusOK, kept.StatusCode)

	deleted := testutil.ExecuteWithAuth(t, ctx.router, testutil.NewAuthenticatedRequest(t, http.MethodDelete, fmt.Sprintf("/activities/%d", activity.ID), nil), testutil.DefaultTestClaims())
	assert.Equal(t, http.StatusForbidden, deleted.Code, deleted.Body.String())
}

// A team's own activity that only shares a system name is an ordinary one.
func TestUpdateActivityWithSystemName_MovesCategory(t *testing.T) {
	t.Parallel()
	ctx := setupActivitiesRoute(t)

	activity := testpkg.CreateTestActivityGroup(t, ctx.db, "WC")
	other := testpkg.CreateTestActivityCategory(t, ctx.db, fmt.Sprintf("Sport-%d", time.Now().UnixNano()))
	assert.Equal(t, false, activityDetail(t, ctx, activity.ID)["is_system"])

	moved := moveActivityCategory(t, ctx, activity.ID, other.ID)
	defer func() { _ = moved.Body.Close() }()
	assert.Equal(t, http.StatusOK, moved.StatusCode)
}
