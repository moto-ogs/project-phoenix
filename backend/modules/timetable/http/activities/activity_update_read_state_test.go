package httpadapter_test

import (
	"fmt"
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/api/testutil"
	"github.com/moto-ogs/project-phoenix/sharedkernel/readstate"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// activityDetail is the data of GET /activities/{id}.
func activityDetail(t *testing.T, ctx *testContext, id any) map[string]any {
	t.Helper()
	req := testutil.NewAuthenticatedRequest(t, http.MethodGet, fmt.Sprintf("/activities/%v", id), nil)
	rr := testutil.ExecuteWithAuth(t, ctx.router, req, testutil.DefaultTestClaims())
	require.Equal(t, http.StatusOK, rr.Code, rr.Body.String())
	data, ok := testutil.ParseJSONResponse(t, rr.Body.Bytes())["data"].(map[string]any)
	require.True(t, ok)
	return data
}

// activityVersion is the version the activity's detail read shows now.
func activityVersion(t *testing.T, ctx *testContext, id any) string {
	t.Helper()
	version, _ := activityDetail(t, ctx, id)["version"].(string)
	require.NotEmpty(t, version)
	return version
}

func putActivity(t *testing.T, ctx *testContext, id any, body map[string]any) int {
	t.Helper()
	req := testutil.NewAuthenticatedRequest(t, http.MethodPut, fmt.Sprintf("/activities/%v", id), body)
	rr := testutil.ExecuteWithAuth(t, ctx.router, req, testutil.DefaultTestClaims())
	if rr.Code == http.StatusConflict {
		assert.Contains(t, rr.Body.String(), `"code":"`+readstate.ChangedCode+`"`)
	}
	return rr.Code
}

// The database form sends only name, limit, category and primary
// supervisor. Its save keeps the opening, the planned room, the schedules
// and the co-supervisor, and a save over a state read before a later change
// is refused without writing (ADR 0311).
func TestUpdateActivity_KeepsUnsentPartsAndRefusesStaleVersion(t *testing.T) {
	t.Parallel()
	ctx := setupActivitiesRoute(t)
	category := testpkg.CreateTestActivityCategory(t, ctx.db, "Read state")
	room := testpkg.CreateTestRoom(t, ctx.db, "Read state room")
	primary := testpkg.CreateTestStaff(t, ctx.db, "Primary", "Lead")
	co := testpkg.CreateTestStaff(t, ctx.db, "Co", "Lead")

	create := testutil.NewAuthenticatedRequest(t, http.MethodPost, "/activities/", map[string]any{
		"name": "Fußball AG", "max_participants": 12, "is_open": true, "category_id": fmt.Sprint(category.ID),
		"planned_room_id": fmt.Sprint(room.ID), "schedules": []map[string]any{{"weekday": 2}, {"weekday": 4}},
		"supervisor_ids": []string{fmt.Sprint(primary.ID), fmt.Sprint(co.ID)},
	})
	created := testutil.ExecuteWithAuth(t, ctx.router, create, traegerActivityClaims(t, ctx))
	require.Equal(t, http.StatusCreated, created.Code, created.Body.String())
	id := testutil.ParseJSONResponse(t, created.Body.Bytes())["data"].(map[string]any)["id"]
	read := activityVersion(t, ctx, id)

	// The database form's body, with the primary supervisor kept first.
	saved := putActivity(t, ctx, id, map[string]any{
		"name": "Fußball AG Nord", "max_participants": 14, "category_id": fmt.Sprint(category.ID),
		"expected_version": read,
	})
	require.Equal(t, http.StatusOK, saved)
	after := activityDetail(t, ctx, id)
	assert.Equal(t, "Fußball AG Nord", after["name"])
	assert.Equal(t, true, after["is_open"], "the save must not close the activity")
	assert.Equal(t, fmt.Sprint(room.ID), fmt.Sprint(after["planned_room_id"]), "the save must keep the planned room")
	assert.Len(t, after["schedules"], 2, "the save must keep the schedules")
	assert.Len(t, after["supervisors"], 2, "the save must keep the co-supervisor")

	// A second editor read before the save above: refused, nothing written.
	assert.Equal(t, http.StatusConflict, putActivity(t, ctx, id, map[string]any{
		"name": "Überholt", "category_id": fmt.Sprint(category.ID), "expected_version": read,
	}))
	assert.Equal(t, http.StatusConflict, putActivity(t, ctx, id, map[string]any{
		"name": "Ohne Stand", "category_id": fmt.Sprint(category.ID),
	}))
	assert.Equal(t, "Fußball AG Nord", activityDetail(t, ctx, id)["name"])

	// The token covers the supervisors, which live in rows of their own.
	current := activityVersion(t, ctx, id)
	var coRow any
	for _, supervisor := range activityDetail(t, ctx, id)["supervisors"].([]any) {
		if row := supervisor.(map[string]any); row["is_primary"] != true {
			coRow = row["id"]
		}
	}
	require.NotNil(t, coRow)
	remove := testutil.NewAuthenticatedRequest(t, http.MethodDelete, fmt.Sprintf("/activities/%v/supervisors/%v", id, coRow), nil)
	removed := testutil.ExecuteWithAuth(t, ctx.router, remove, testutil.DefaultTestClaims())
	require.Less(t, removed.Code, 300, removed.Body.String())
	assert.Equal(t, http.StatusConflict, putActivity(t, ctx, id, map[string]any{
		"name": "Überholt", "category_id": fmt.Sprint(category.ID), "supervisor_ids": []string{fmt.Sprint(primary.ID), fmt.Sprint(co.ID)}, "expected_version": current,
	}))
	assert.Len(t, activityDetail(t, ctx, id)["supervisors"], 1)
}

// A save that changes the category and the supervisors together pins the
// category before it locks the staff rows (canonical lock order, #6702)
// and stores both.
func TestUpdateActivity_ChangesCategoryAndSupervisorsTogether(t *testing.T) {
	t.Parallel()
	ctx := setupActivitiesRoute(t)
	before := testpkg.CreateTestActivityCategory(t, ctx.db, "Vorher")
	after := testpkg.CreateTestActivityCategory(t, ctx.db, "Nachher")
	first := testpkg.CreateTestStaff(t, ctx.db, "Erste", "Leitung")
	second := testpkg.CreateTestStaff(t, ctx.db, "Zweite", "Leitung")

	create := testutil.NewAuthenticatedRequest(t, http.MethodPost, "/activities/", map[string]any{
		"name": "Schach AG", "max_participants": 10, "category_id": fmt.Sprint(before.ID),
		"supervisor_ids": []string{fmt.Sprint(first.ID)},
	})
	created := testutil.ExecuteWithAuth(t, ctx.router, create, traegerActivityClaims(t, ctx))
	require.Equal(t, http.StatusCreated, created.Code, created.Body.String())
	id := testutil.ParseJSONResponse(t, created.Body.Bytes())["data"].(map[string]any)["id"]

	req := testutil.NewAuthenticatedRequest(t, http.MethodPut, fmt.Sprintf("/activities/%v", id), map[string]any{
		"name": "Schach AG", "max_participants": 10, "category_id": fmt.Sprint(after.ID),
		"supervisor_ids": []string{fmt.Sprint(second.ID)}, "expected_version": activityVersion(t, ctx, id),
	})
	rr := testutil.ExecuteWithAuth(t, ctx.router, req, testutil.DefaultTestClaims())
	require.Equal(t, http.StatusOK, rr.Code, rr.Body.String())
	stored := activityDetail(t, ctx, id)
	assert.Equal(t, fmt.Sprint(after.ID), fmt.Sprint(stored["category_id"]))
	supervisors := stored["supervisors"].([]any)
	require.Len(t, supervisors, 1)
	assert.Equal(t, fmt.Sprint(second.ID), fmt.Sprint(supervisors[0].(map[string]any)["staff_id"]))
}
