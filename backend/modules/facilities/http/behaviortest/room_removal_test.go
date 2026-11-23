package httpadapter_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/moto-ogs/project-phoenix/api/testutil"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type removalImpactBody struct {
	Data struct {
		Outcome       string `json:"outcome"`
		ActiveSession bool   `json:"active_session"`
		References    struct {
			UpcomingBlocks  int `json:"upcoming_blocks"`
			EducationGroups int `json:"education_groups"`
			PastBlocks      int `json:"past_blocks"`
		} `json:"references"`
		Fingerprint string `json:"fingerprint"`
	} `json:"data"`
}

// The removal impact names what still uses a room; DELETE refuses such a
// room with a code of its own instead of a 500, and archives a room only
// history names (#6845). DELETE carries the fingerprint of the preview it
// confirms and is refused when the room changed since (ADR 0311).
func TestRoomRemovalFollowsItsImpact(t *testing.T) {
	t.Parallel()
	tc := setupRoomsRoute(t)
	claims := testutil.AdminTestClaims(1)
	room := testpkg.CreateTestRoom(t, tc.db, fmt.Sprintf("Removal %d", testpkg.Tenant(t)))
	group := testpkg.CreateTestEducationGroup(t, tc.db, "Removal group")
	_, err := tc.db.NewRaw(`UPDATE education.groups SET room_id = ? WHERE id = ?`, room.ID, group.ID).Exec(context.Background())
	require.NoError(t, err)
	upcoming := testpkg.CreateTestActivityInstance(t, tc.db, calendar.NewDate(2099, 3, 2), room.ID, testpkg.ActivityInstanceOpts{})
	testpkg.CreateTestActivityInstance(t, tc.db, calendar.NewDate(2020, 3, 2), room.ID, testpkg.ActivityInstanceOpts{})

	unused := readImpact(t, tc, testpkg.CreateTestRoom(t, tc.db, fmt.Sprintf("Unused %d", testpkg.Tenant(t))).ID)
	require.Equal(t, "delete", unused.Data.Outcome)
	impact := readImpact(t, tc, room.ID)
	assert.Equal(t, "blocked", impact.Data.Outcome)
	assert.Equal(t, 1, impact.Data.References.EducationGroups)
	assert.Equal(t, 1, impact.Data.References.UpcomingBlocks)
	assert.Equal(t, 1, impact.Data.References.PastBlocks)

	rr := removeRoom(t, tc, room.ID, impact.Data.Fingerprint)
	require.Equal(t, http.StatusConflict, rr.Code, rr.Body.String())
	assert.Contains(t, rr.Body.String(), `"code":"rooms.still_planned"`)
	assert.Contains(t, rr.Body.String(), `"education_groups":1`)

	_, err = tc.db.NewRaw(`UPDATE education.groups SET room_id = NULL WHERE id = ?`, group.ID).Exec(context.Background())
	require.NoError(t, err)
	_, err = tc.db.NewRaw(`UPDATE schedule.activity_instances SET status = 'cancelled' WHERE id = ?`, upcoming.ID).Exec(context.Background())
	require.NoError(t, err)
	archive := readImpact(t, tc, room.ID)
	assert.Equal(t, "archive", archive.Data.Outcome)

	// A delete confirmed for an unused room does not archive this one.
	for _, stale := range []string{unused.Data.Fingerprint, ""} {
		rr = removeRoom(t, tc, room.ID, stale)
		require.Equal(t, http.StatusConflict, rr.Code, rr.Body.String())
		assert.Contains(t, rr.Body.String(), `"code":"general.changed_since_read"`)
	}
	var archivedAt *string
	require.NoError(t, tc.db.NewRaw(`SELECT archived_at::text FROM facilities.rooms WHERE id = ?`, room.ID).Scan(context.Background(), &archivedAt))
	require.Nil(t, archivedAt, "a refused removal leaves the room as it was")

	rr = removeRoom(t, tc, room.ID, archive.Data.Fingerprint)
	require.Equal(t, http.StatusOK, rr.Code, rr.Body.String())
	assert.Contains(t, rr.Body.String(), `"outcome":"archive"`)

	rr = testutil.ExecuteWithAuth(t, tc.router, testutil.NewRequest(http.MethodGet, fmt.Sprintf("/%d", room.ID), nil), claims)
	require.Equal(t, http.StatusOK, rr.Code, rr.Body.String())
	assert.Contains(t, rr.Body.String(), `"archived_at"`, "the archived room still resolves for its history")

	rr = testutil.ExecuteWithAuth(t, tc.router, testutil.NewJSONRequest(t, http.MethodPut, fmt.Sprintf("/%d", room.ID), map[string]any{"name": "Neu"}), claims)
	require.Equal(t, http.StatusConflict, rr.Code, rr.Body.String())
	assert.Contains(t, rr.Body.String(), `"code":"rooms.archived"`)
}

func removeRoom(t *testing.T, tc *testContext, roomID int64, fingerprint string) *httptest.ResponseRecorder {
	t.Helper()
	request := testutil.NewJSONRequest(t, http.MethodDelete, fmt.Sprintf("/%d", roomID), map[string]any{"expected_fingerprint": fingerprint})
	return testutil.ExecuteWithAuth(t, tc.router, request, testutil.AdminTestClaims(1))
}

func readImpact(t *testing.T, tc *testContext, roomID int64) removalImpactBody {
	t.Helper()
	rr := testutil.ExecuteWithAuth(t, testpkg.MountedQueryBudgetRouter("/api/rooms", tc.router), testutil.NewRequest(http.MethodGet, fmt.Sprintf("/%d/removal-impact", roomID), nil), testutil.AdminTestClaims(1))
	require.Equal(t, http.StatusOK, rr.Code, rr.Body.String())
	var body removalImpactBody
	require.NoError(t, json.Unmarshal(rr.Body.Bytes(), &body))
	return body
}
