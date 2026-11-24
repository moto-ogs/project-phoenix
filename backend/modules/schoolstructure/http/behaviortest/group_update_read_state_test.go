package schoolstructurehttp_test

import (
	"fmt"
	"net/http"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/api/testutil"
	"github.com/moto-ogs/project-phoenix/sharedkernel/readstate"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// groupDetail is the data of GET /groups/{id}.
func groupDetail(t *testing.T, router chi.Router, id int64, claims testutil.Claims) map[string]any {
	t.Helper()
	rr := testutil.ExecuteRequest(router, newReq(t, http.MethodGet, fmt.Sprintf("/groups/%d", id), nil, claims, "groups:read"))
	require.Equal(t, http.StatusOK, rr.Code, rr.Body.String())
	data, ok := testutil.ParseJSONResponse(t, rr.Body.Bytes())["data"].(map[string]any)
	require.True(t, ok)
	return data
}

// groupVersion is the version the group's detail read shows now.
func groupVersion(t *testing.T, router chi.Router, id int64, claims testutil.Claims) string {
	t.Helper()
	version, _ := groupDetail(t, router, id, claims)["version"].(string)
	require.NotEmpty(t, version)
	return version
}

// Resolving a caregiver blocker sends the group's name and new teachers
// only. The save keeps the group's room, and a save over a state read
// before a later change is refused without writing (ADR 0311).
func TestUpdateGroup_TeachersOnlyKeepsRoomAndRefusesStaleVersion(t *testing.T) {
	t.Parallel()
	tc, router := setupProtectedRouter(t)
	claims := testutil.DefaultTestClaims()
	room := testpkg.CreateTestRoom(t, tc.db, "BlockerRoom")
	group := testpkg.CreateTestEducationGroup(t, tc.db, "BlockerGroup")
	leaving := testpkg.CreateTestTeacher(t, tc.db, "Leaving", "Teacher")
	replacement := testpkg.CreateTestTeacher(t, tc.db, "Replacement", "Teacher")
	put := func(body map[string]any) int {
		rr := testutil.ExecuteRequest(router, newReq(t, http.MethodPut, fmt.Sprintf("/groups/%d", group.ID), body, claims, "groups:update"))
		if rr.Code == http.StatusConflict {
			assert.Contains(t, rr.Body.String(), `"code":"`+readstate.ChangedCode+`"`)
		}
		return rr.Code
	}
	require.Equal(t, http.StatusOK, put(map[string]any{
		"name": group.Name, "room_id": fmt.Sprint(room.ID), "teacher_ids": []string{fmt.Sprint(leaving.ID)},
		"expected_version": groupVersion(t, router, group.ID, claims),
	}))
	read := groupVersion(t, router, group.ID, claims)
	list := testutil.ExecuteRequest(router, newReq(t, http.MethodGet, "/groups/", nil, claims, "groups:read"))
	require.Equal(t, http.StatusOK, list.Code, list.Body.String())
	for _, row := range testutil.ParseJSONResponse(t, list.Body.Bytes())["data"].([]any) {
		if row := row.(map[string]any); row["id"] == fmt.Sprint(group.ID) {
			assert.Equal(t, read, row["version"], "the list row carries the detail read's version")
		}
	}

	// The body of the caregiver blocker resolution.
	require.Equal(t, http.StatusOK, put(map[string]any{
		"name": group.Name, "teacher_ids": []string{fmt.Sprint(replacement.ID)}, "expected_version": read,
	}))
	after := groupDetail(t, router, group.ID, claims)
	assert.Equal(t, fmt.Sprint(room.ID), fmt.Sprint(after["room_id"]), "replacing the teachers must keep the room")
	require.Len(t, after["teachers"], 1)
	assert.Equal(t, fmt.Sprint(replacement.ID), fmt.Sprint(after["teachers"].([]any)[0].(map[string]any)["id"]))

	// Read before the teacher change: refused, nothing written.
	assert.Equal(t, http.StatusConflict, put(map[string]any{
		"name": group.Name, "teacher_ids": []string{fmt.Sprint(leaving.ID)}, "expected_version": read,
	}))
	assert.Equal(t, http.StatusConflict, put(map[string]any{"name": "Ohne Stand"}))
	after = groupDetail(t, router, group.ID, claims)
	assert.Equal(t, group.Name, after["name"])
	assert.Equal(t, fmt.Sprint(replacement.ID), fmt.Sprint(after["teachers"].([]any)[0].(map[string]any)["id"]))

	// room_id null clears the room.
	require.Equal(t, http.StatusOK, put(map[string]any{
		"name": group.Name, "room_id": nil, "expected_version": groupVersion(t, router, group.ID, claims),
	}))
	assert.Nil(t, groupDetail(t, router, group.ID, claims)["room_id"])
}
