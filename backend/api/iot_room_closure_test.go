package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"

	"github.com/moto-ogs/project-phoenix/api/testutil"
	scanBindings "github.com/moto-ogs/project-phoenix/roots/devicescanbinding"
	"github.com/moto-ogs/project-phoenix/roots/owners"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// closeRoomToday closes the room for yesterday through tomorrow of the
// school's day, the database's Berlin day.
func closeRoomToday(t *testing.T, db *bun.DB, tenantID, roomID int64) {
	t.Helper()
	_, err := db.ExecContext(context.Background(), `INSERT INTO facilities.room_closures (tenant_id, room_id, start_date, end_date, reason)
		VALUES (?, ?, (now() AT TIME ZONE 'Europe/Berlin')::date - 1, (now() AT TIME ZONE 'Europe/Berlin')::date + 1, 'Wasserschaden')`, tenantID, roomID)
	require.NoError(t, err)
}

// TestKioskListsNoClosedRoom pins the kiosk's room list (#7653): a room
// closed today is not offered, an open one of the same school is.
func TestKioskListsNoClosedRoom(t *testing.T) {
	t.Parallel()
	db, module, _ := setupIoTDataModule(t)
	open := testpkg.CreateTestRoom(t, db, "Offener Kioskraum")
	closed := testpkg.CreateTestRoom(t, db, "Gesperrter Kioskraum")
	closeRoomToday(t, db, testpkg.Tenant(t), closed.ID)
	device := testpkg.CreateTestDevice(t, db, "closed-room-list")

	resource := newIoTRouterTestResource()
	alreadyAuthenticated := func(next http.Handler) http.Handler { return next }
	resource.DeviceAuthenticator, resource.DeviceOnlyAuthenticator = alreadyAuthenticated, alreadyAuthenticated
	resource.Rooms = module.RoomAvailability
	handler := testpkg.TenantRuntimeMiddleware(t, db)(resource.Router())

	request := testutil.NewAuthenticatedRequest(t, http.MethodGet, "/rooms/available", nil, testutil.WithDeviceContext(device))
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	var body struct {
		Data []struct {
			ID int64 `json:"id"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(response.Body.Bytes(), &body))
	listed := map[int64]bool{}
	for _, room := range body.Data {
		listed[room.ID] = true
	}
	assert.True(t, listed[open.ID], "the open room is offered")
	assert.False(t, listed[closed.ID], "the closed room is not offered")
}

// TestKioskSessionStartRefusesAClosedRoom pins the session start (#7653): a
// session in a room closed today is refused with iot.room_closed, with and
// without force, and nothing of the start is written. A room another school
// closed does not close the own one.
func TestKioskSessionStartRefusesAClosedRoom(t *testing.T) {
	t.Parallel()
	db, active, _, _, activePresence, activePeople := setupIoTActiveModule(t)
	activity := testpkg.CreateTestActivityGroup(t, db, "Gesperrte Aktivität")
	closed := testpkg.CreateTestRoom(t, db, "Gesperrter Sitzungsraum")
	closeRoomToday(t, db, testpkg.Tenant(t), closed.ID)
	open := testpkg.CreateTestRoom(t, db, "Offener Sitzungsraum")
	foreignTenant := testpkg.UniqueTestTenantID(t)
	testpkg.EnsureTestTenant(t, db, foreignTenant)
	closeRoomToday(t, db, foreignTenant, testpkg.CreateTestRoomForTenant(t, db, foreignTenant, "Offener Sitzungsraum").ID)
	staff := testpkg.CreateTestStaff(t, db, "Gesperrt", "Betreuung")
	device := testpkg.CreateTestDevice(t, db, "closed-room-start")

	resource := newIoTRouterTestResource()
	alreadyAuthenticated := func(next http.Handler) http.Handler { return next }
	resource.DeviceAuthenticator, resource.DeviceOnlyAuthenticator = alreadyAuthenticated, alreadyAuthenticated
	resource.SessionLifecycle = scanBindings.NewSessionLifecycle(activePresence.Active, owners.NewLoggedStudentPresence(testpkg.NewDatabase(t, db), nil),
		owners.UnavailableMirrorSupervisions{}, NewDeviceScanPeople(activePeople.Users), active.IoT, nil, NewRoomClosuresForTest(testpkg.NewDatabase(t, db)), nil, DeviceScanPrincipal, time.Now)
	handler := testpkg.TenantRuntimeMiddleware(t, db)(resource.Router())
	start := func(roomID int64, force bool) *httptest.ResponseRecorder {
		request := testutil.NewAuthenticatedRequest(t, http.MethodPost, "/session/start", map[string]any{
			"activity_id": activity.ID, "room_id": roomID, "supervisor_ids": []int64{staff.ID}, "force": force,
		}, testutil.WithDeviceContext(device))
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		return response
	}
	sessions := func() int {
		var count int
		require.NoError(t, db.NewRaw(`SELECT count(*) FROM active.groups WHERE device_id = ?`, device.ID).Scan(context.Background(), &count))
		return count
	}

	for _, force := range []bool{false, true} {
		response := start(closed.ID, force)
		require.Equal(t, http.StatusBadRequest, response.Code, "force=%v: %s", force, response.Body.String())
		var problem struct {
			Code string `json:"code"`
		}
		require.NoError(t, json.Unmarshal(response.Body.Bytes(), &problem))
		assert.Equal(t, "iot.room_closed", problem.Code, "force=%v", force)
		assert.Zero(t, sessions(), "force=%v: the refused start writes no session", force)
	}

	response := start(open.ID, false)
	require.Equal(t, http.StatusOK, response.Code, "the open room takes the session: %s", response.Body.String())
	assert.Equal(t, 1, sessions())
}
