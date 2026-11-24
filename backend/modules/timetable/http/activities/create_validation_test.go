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

// The create routes refuse a blank name and an explicit participant limit
// below one. The staff portal's route files checked both until #7563 moved
// the routes to the catalog proxy; the backend holds the rule now.
func TestCreateRoutesRefuseBlankNameAndZeroLimit(t *testing.T) {
	t.Parallel()
	ctx := setupActivitiesRoute(t)

	cases := []struct {
		name string
		path string
		body map[string]any
	}{
		{"create, blank name", "/activities", map[string]any{"name": "   ", "category_id": "1", "is_open": true}},
		{"create, zero limit", "/activities", map[string]any{"name": "Fußball", "category_id": "1", "max_participants": 0}},
		{"quick-create, blank name", "/activities/quick-create", map[string]any{"name": " ", "category_id": "1"}},
		{"quick-create, zero limit", "/activities/quick-create", map[string]any{"name": "Fußball", "category_id": "1", "max_participants": 0}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			req := testutil.NewAuthenticatedRequest(t, http.MethodPost, tc.path, tc.body)
			rr := testutil.ExecuteWithAuth(t, ctx.router, req, testutil.DefaultTestClaims())
			testutil.AssertBadRequest(t, rr)
		})
	}
}

// An update keeps taking 0 as "no limit": only the create routes refused it.
func TestUpdateActivityKeepsZeroAsNoLimit(t *testing.T) {
	t.Parallel()
	ctx := setupActivitiesRoute(t)
	activity := testpkg.CreateTestActivityGroup(t, ctx.db, "Zero limit update")

	body := map[string]any{"name": "Zero limit update", "max_participants": 0, "is_open": true, "category_id": fmt.Sprint(activity.CategoryID), "expected_version": activityVersion(t, ctx, activity.ID)}
	req := testutil.NewAuthenticatedRequest(t, http.MethodPut, fmt.Sprintf("/activities/%d", activity.ID), body)
	rr := testutil.ExecuteWithAuth(t, ctx.router, req, testutil.DefaultTestClaims())

	require.Equal(t, http.StatusOK, rr.Code, "body: %s", rr.Body.String())
	data, ok := testutil.ParseJSONResponse(t, rr.Body.Bytes())["data"].(map[string]any)
	require.True(t, ok)
	assert.Nil(t, data["max_participants"])
}
