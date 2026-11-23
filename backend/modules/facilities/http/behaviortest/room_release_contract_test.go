package httpadapter_test

// Inbound contract for the room release (#3064): the release is an
// administrative decision, so a caller without the room-update permission must
// be refused server-side — not merely shown a form without the switch.

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"

	"github.com/moto-ogs/project-phoenix/api/testutil"
	"github.com/moto-ogs/project-phoenix/modules/facilities"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

func itoa(id int64) string { return strconv.FormatInt(id, 10) }

// roomIsReleased reads the stored release straight from the row, so the
// assertion does not lean on the same read path the write just used.
func roomIsReleased(t *testing.T, db *bun.DB, tenantID, roomID int64) bool {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	var released bool
	err := db.NewRaw(
		`SELECT is_open_room FROM facilities.rooms WHERE id = ? AND tenant_id = ?;`,
		roomID, tenantID,
	).Scan(ctx, &released)
	require.NoError(t, err, "load is_open_room for room %d", roomID)
	return released
}

// roomReleasePayload is the room form's save of the release, against the
// room as it is stored now.
func roomReleasePayload(t *testing.T, db bun.IDB, roomID int64, name string, released bool) string {
	t.Helper()
	body, err := json.Marshal(map[string]any{
		"name": name, "is_open_room": released, "expected_version": storedRoomVersion(t, db, roomID),
	})
	require.NoError(t, err)
	return string(body)
}

// storedRoomVersion is the version a read of the room answers now.
func storedRoomVersion(t *testing.T, db bun.IDB, roomID int64) string {
	t.Helper()
	var room facilities.Room
	require.NoError(t, db.NewRaw(`SELECT updated_at FROM facilities.rooms WHERE id = ?`, roomID).Scan(context.Background(), &room.UpdatedAt))
	return facilities.RoomVersion(room)
}

func TestRoomRelease_RequiresTheRoomUpdatePermission(t *testing.T) {
	t.Parallel()
	tc := setupRoomsRoute(t)
	tenantID := newRoomFilterTestTenant(t, tc.db)
	claims := testutil.AdminTestClaimsForTenant(1, tenantID)

	room := testpkg.CreateTestRoomForTenant(t, tc.db, tenantID, "ReleaseGuarded")

	t.Run("read-only caller cannot release a room", func(t *testing.T) {
		req := testutil.NewRequest(
			"PUT",
			"/"+itoa(room.ID),
			bytes.NewReader([]byte(roomReleasePayload(t, tc.db, room.ID, room.Name, true))),
		)
		req.Header.Set("Content-Type", "application/json")
		rr := testutil.ExecuteWithAuthPermissions(
			t, tc.router, req, claims, []string{"rooms:read"},
		)
		assert.Equal(t, http.StatusForbidden, rr.Code,
			"rooms:read alone must not be enough to release a room. Body: %s", rr.Body.String())
		assert.False(t, roomIsReleased(t, tc.db, tenantID, room.ID),
			"the refused request must not have written the release")
	})

	t.Run("an authorized administrator can release it", func(t *testing.T) {
		req := testutil.NewRequest(
			"PUT",
			"/"+itoa(room.ID),
			bytes.NewReader([]byte(roomReleasePayload(t, tc.db, room.ID, room.Name, true))),
		)
		req.Header.Set("Content-Type", "application/json")
		rr := testutil.ExecuteWithAuthPermissions(
			t, tc.router, req, claims, []string{"rooms:read", "rooms:update"},
		)
		require.Equal(t, http.StatusOK, rr.Code, "Body: %s", rr.Body.String())
		assert.True(t, roomIsReleased(t, tc.db, tenantID, room.ID))
	})

	t.Run("and can revoke it again", func(t *testing.T) {
		req := testutil.NewRequest(
			"PUT",
			"/"+itoa(room.ID),
			bytes.NewReader([]byte(roomReleasePayload(t, tc.db, room.ID, room.Name, false))),
		)
		req.Header.Set("Content-Type", "application/json")
		rr := testutil.ExecuteWithAuthPermissions(
			t, tc.router, req, claims, []string{"rooms:read", "rooms:update"},
		)
		require.Equal(t, http.StatusOK, rr.Code, "Body: %s", rr.Body.String())
		assert.False(t, roomIsReleased(t, tc.db, tenantID, room.ID))
	})
}

// TestRoomRelease_IsCarriedOnTheReadContract pins the wire field the client
// maps: without it the form could never show the stored state.
func TestRoomRelease_IsCarriedOnTheReadContract(t *testing.T) {
	t.Parallel()
	tc := setupRoomsRoute(t)
	tenantID := newRoomFilterTestTenant(t, tc.db)
	claims := testutil.AdminTestClaimsForTenant(1, tenantID)

	room := testpkg.CreateTestRoomForTenant(t, tc.db, tenantID, "ReleaseOnWire")
	releaseRoom(t, tc.db, tenantID, room.ID, true)

	req := testutil.NewRequest("GET", "/"+itoa(room.ID), nil)
	rr := testutil.ExecuteWithAuth(t, tc.router, req, claims)
	require.Equal(t, http.StatusOK, rr.Code, "Body: %s", rr.Body.String())
	assert.Contains(t, rr.Body.String(), `"is_open_room":true`,
		"the read contract must carry the release so the room form can show it")
}

// TestRoomList_FiltersByTheReleaseQueryParameter is the read the shared
// open-room navigation uses (#3065): it needs the released rooms including the
// empty ones, by stable room ID, without a synthetic entry.
func TestRoomList_FiltersByTheReleaseQueryParameter(t *testing.T) {
	t.Parallel()
	tc := setupRoomsRoute(t)
	tenantID := newRoomFilterTestTenant(t, tc.db)
	claims := testutil.AdminTestClaimsForTenant(1, tenantID)

	gym := testpkg.CreateTestRoomForTenant(t, tc.db, tenantID, "ReleaseNavGym")
	hall := testpkg.CreateTestRoomForTenant(t, tc.db, tenantID, "ReleaseNavHall")
	releaseRoom(t, tc.db, tenantID, gym.ID, true)

	t.Run("is_open_room=true returns only released rooms", func(t *testing.T) {
		req := testutil.NewRequest("GET", "/?is_open_room=true", nil)
		rr := testutil.ExecuteWithAuth(t, tc.router, req, claims)
		require.Equal(t, http.StatusOK, rr.Code, "Body: %s", rr.Body.String())
		ids := roomResponseIDs(t, rr.Body.Bytes())
		assert.True(t, ids[gym.ID])
		assert.False(t, ids[hall.ID])
	})

	t.Run("is_open_room=false returns only unreleased rooms", func(t *testing.T) {
		req := testutil.NewRequest("GET", "/?is_open_room=false", nil)
		rr := testutil.ExecuteWithAuth(t, tc.router, req, claims)
		require.Equal(t, http.StatusOK, rr.Code)
		ids := roomResponseIDs(t, rr.Body.Bytes())
		assert.False(t, ids[gym.ID])
		assert.True(t, ids[hall.ID])
	})

	t.Run("an absent parameter narrows nothing", func(t *testing.T) {
		req := testutil.NewRequest("GET", "/", nil)
		rr := testutil.ExecuteWithAuth(t, tc.router, req, claims)
		require.Equal(t, http.StatusOK, rr.Code)
		ids := roomResponseIDs(t, rr.Body.Bytes())
		assert.True(t, ids[gym.ID])
		assert.True(t, ids[hall.ID])
	})

	t.Run("an unrecognised value is treated as absent, not guessed", func(t *testing.T) {
		req := testutil.NewRequest("GET", "/?is_open_room=yes", nil)
		rr := testutil.ExecuteWithAuth(t, tc.router, req, claims)
		require.Equal(t, http.StatusOK, rr.Code)
		ids := roomResponseIDs(t, rr.Body.Bytes())
		assert.True(t, ids[gym.ID])
		assert.True(t, ids[hall.ID])
	})
}
