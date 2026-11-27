package api

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/api/testutil"
	scanBindings "github.com/moto-ogs/project-phoenix/roots/devicescanbinding"
	"github.com/moto-ogs/project-phoenix/roots/owners"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// A kiosk authenticates before its session start runs. When the device is
// removed in between, the start must not open a session on the archived
// device (#2319). The pass-through authenticator and the request's device
// context stand for that earlier authentication.
func TestSessionStartRefusesADeviceRemovedAfterAuthentication(t *testing.T) {
	t.Parallel()
	db, active, _, _, activePresence, activePeople := setupIoTActiveModule(t)
	activity := testpkg.CreateTestActivityGroup(t, db, "Removed Device Activity")
	room := testpkg.CreateTestRoom(t, db, "Removed Device Room")
	staff := testpkg.CreateTestStaff(t, db, "Removed", "Device")
	device := testpkg.CreateTestDevice(t, db, "removed-before-start")
	_, err := db.NewUpdate().TableExpr("iot.devices").Set("archived_at = now()").Set("api_key_hash = NULL").
		Where("id = ?", device.ID).Exec(context.Background())
	require.NoError(t, err)

	resource := newIoTRouterTestResource()
	alreadyAuthenticated := func(next http.Handler) http.Handler { return next }
	resource.DeviceAuthenticator = alreadyAuthenticated
	resource.DeviceOnlyAuthenticator = alreadyAuthenticated
	resource.SessionLifecycle = scanBindings.NewSessionLifecycle(activePresence.Active, owners.NewLoggedStudentPresence(testpkg.NewDatabase(t, db), nil),
		owners.UnavailableMirrorSupervisions{}, NewDeviceScanPeople(activePeople.Users), active.IoT, nil, NewRoomClosuresForTest(testpkg.NewDatabase(t, db)), nil, DeviceScanPrincipal, time.Now)
	handler := testpkg.TenantRuntimeMiddleware(t, db)(resource.Router())

	for _, force := range []bool{false, true} {
		request := testutil.NewAuthenticatedRequest(t, http.MethodPost, "/session/start", map[string]any{
			"activity_id": activity.ID, "room_id": room.ID, "supervisor_ids": []int64{staff.ID}, "force": force,
		}, testutil.WithDeviceContext(device))
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		require.Equal(t, http.StatusUnauthorized, response.Code, "force=%v: %s", force, response.Body.String())
	}

	var sessions int
	require.NoError(t, db.NewRaw(`SELECT count(*) FROM active.groups WHERE device_id = ?`, device.ID).Scan(context.Background(), &sessions))
	assert.Zero(t, sessions, "no session opens on a removed device")
}
