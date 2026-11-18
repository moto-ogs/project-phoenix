//go:build testhooks

package api

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/api/testutil"
	"github.com/moto-ogs/project-phoenix/modules/devicefleet"
	owners "github.com/moto-ogs/project-phoenix/roots/owners"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// newDeviceBlockingFixture is the school device route over a fresh test
// database, with the status change audit captured.
func newDeviceBlockingFixture(t *testing.T) deviceRemovalFixture {
	t.Helper()
	return deviceFixtureOn(t, testpkg.SetupTestDB(t))
}

func (f deviceRemovalFixture) setStatus(t *testing.T, deviceID, status string, permissions ...string) *httptest.ResponseRecorder {
	t.Helper()
	claims := testutil.DefaultTestClaims()
	if len(permissions) == 0 {
		permissions = []string{"iot:update"}
	} else {
		// A staff account without the admin role holds only the given
		// permissions.
		claims.Roles, claims.Permissions, claims.IsAdmin = []string{"user"}, permissions, false
	}
	req := testutil.NewAuthenticatedRequest(t, http.MethodPatch, fmt.Sprintf("/devices/%s/status", deviceID),
		map[string]string{"status": status},
		testutil.WithClaims(t, claims),
		testutil.WithPermissions(permissions...),
	)
	return testutil.ExecuteRequest(f.router, req)
}

// kioskCall authenticates one kiosk request with the device's API key
// through the production device authentication.
func (f deviceRemovalFixture) kioskCall(t *testing.T, apiKey string) *httptest.ResponseRecorder {
	t.Helper()
	database := testpkg.NewDatabase(t, f.db)
	schools, err := NewDeviceSchools(database, database.UnitOfWork())
	require.NoError(t, err)
	settings, err := owners.NewSettingsTestModule(database, database.UnitOfWork())
	require.NoError(t, err)
	auth := testutil.NewDeviceAuthenticators(f.fleet, schools, settings.Settings)
	request := httptest.NewRequest(http.MethodGet, "/kiosk", nil).
		WithContext(testpkg.ContextWithTenantRuntime(context.Background(), database.UnitOfWork()))
	request.Header.Set("Authorization", "Bearer "+apiKey)
	response := httptest.NewRecorder()
	auth.DeviceOnly()(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	})).ServeHTTP(response, request)
	return response
}

func TestDeviceBlockingRefusesTheKioskAndKeepsDeviceRoomAndSlot(t *testing.T) {
	t.Parallel()
	f := newDeviceBlockingFixture(t)
	device := testpkg.CreateTestDevice(t, f.db, "blocking-keep")
	room := testpkg.CreateTestRoom(t, f.db, "Blocking room")
	_, err := f.db.NewUpdate().TableExpr("iot.devices").Set("room_id = ?", room.ID).Where("id = ?", device.ID).Exec(context.Background())
	require.NoError(t, err)
	endedSession := f.startDeviceSession(t, device.ID, true)
	require.Equal(t, http.StatusNoContent, f.kioskCall(t, *device.APIKey).Code)
	slots := f.liveDevicesOfTenant(t, device.TenantID)

	rr := f.setStatus(t, device.DeviceID, "inactive")

	require.Equal(t, http.StatusOK, rr.Code, rr.Body.String())
	stored := f.stored(t, device.ID)
	assert.Nil(t, stored.ArchivedAt, "a blocked device stays a live device")
	assert.Equal(t, devicefleet.DeviceStatusInactive, devicefleet.DeviceStatus(stored.Status))
	assert.NotNil(t, stored.APIKeyHash, "blocking keeps the credential for the unblock")
	require.NotNil(t, stored.RoomID)
	assert.Equal(t, room.ID, *stored.RoomID, "blocking keeps the room")
	assert.Equal(t, slots, f.liveDevicesOfTenant(t, device.TenantID), "a blocked device keeps its Geräteplatz")
	var historyDevice *int64
	require.NoError(t, f.db.NewSelect().TableExpr("active.groups").Column("device_id").Where("id = ?", endedSession).Scan(context.Background(), &historyDevice))
	require.NotNil(t, historyDevice)
	assert.Equal(t, device.ID, *historyDevice, "the history keeps its device")

	kiosk := f.kioskCall(t, *device.APIKey)
	require.Equal(t, http.StatusForbidden, kiosk.Code, "the next kiosk request is refused at once")
	assert.Contains(t, kiosk.Body.String(), `"code":"iot.device_inactive"`)

	entries := auditEntriesOf(t, f.audit, "device_status")
	require.Len(t, entries, 1)
	assert.Equal(t, "blocked", entries[0]["outcome"])
	assert.Equal(t, "active", entries[0]["from_status"])
	assert.EqualValues(t, device.ID, entries[0]["device_row_id"])
	assert.NotContains(t, f.audit.String(), *device.APIKey)
}

func TestDeviceUnblockingRestoresAccessWithTheSameKeyAndIsIdempotent(t *testing.T) {
	t.Parallel()
	f := newDeviceBlockingFixture(t)
	device := testpkg.CreateTestDevice(t, f.db, "blocking-restore")
	require.Equal(t, http.StatusOK, f.setStatus(t, device.DeviceID, "inactive").Code)
	// A repeated block changes nothing and is not audited a second time.
	require.Equal(t, http.StatusOK, f.setStatus(t, device.DeviceID, "inactive").Code)

	rr := f.setStatus(t, device.DeviceID, "active")

	require.Equal(t, http.StatusOK, rr.Code, rr.Body.String())
	assert.Equal(t, devicefleet.DeviceStatusActive, devicefleet.DeviceStatus(f.stored(t, device.ID).Status))
	assert.Equal(t, http.StatusNoContent, f.kioskCall(t, *device.APIKey).Code, "the unblocked kiosk works with its key again")
	require.Equal(t, http.StatusOK, f.setStatus(t, device.DeviceID, "active").Code)

	entries := auditEntriesOf(t, f.audit, "device_status")
	require.Len(t, entries, 2, "only effective changes are audited")
	assert.Equal(t, "blocked", entries[0]["outcome"])
	assert.Equal(t, "unblocked", entries[1]["outcome"])
}

// A hardware ID such as a MAC address reaches the route escaped
// (encodeURIComponent turns the colon into %3A); the route still finds it.
func TestDeviceBlockingFindsAHardwareIDWithAColon(t *testing.T) {
	t.Parallel()
	f := newDeviceBlockingFixture(t)
	device := testpkg.CreateTestDevice(t, f.db, "AA:BB:CC")
	require.Contains(t, device.DeviceID, ":")

	rr := f.setStatus(t, strings.ReplaceAll(device.DeviceID, ":", "%3A"), "inactive")

	require.Equal(t, http.StatusOK, rr.Code, rr.Body.String())
	assert.Equal(t, devicefleet.DeviceStatusInactive, devicefleet.DeviceStatus(f.stored(t, device.ID).Status))
}

// A literal percent sign arrives as %25; Chi has already decoded it, so the
// route must not decode it a second time.
func TestDeviceBlockingFindsAHardwareIDWithAPercentSign(t *testing.T) {
	t.Parallel()
	f := newDeviceBlockingFixture(t)
	device := testpkg.CreateTestDevice(t, f.db, "pct%id")

	rr := f.setStatus(t, strings.ReplaceAll(device.DeviceID, "%", "%25"), "inactive")

	require.Equal(t, http.StatusOK, rr.Code, rr.Body.String())
	assert.Equal(t, devicefleet.DeviceStatusInactive, devicefleet.DeviceStatus(f.stored(t, device.ID).Status))
}

// The general edit can carry a status too; an effective change there is
// audited like the block route's.
func TestDeviceEditWithAStatusChangeIsAudited(t *testing.T) {
	t.Parallel()
	f := newDeviceBlockingFixture(t)
	device := testpkg.CreateTestDevice(t, f.db, "edit-status")
	req := testutil.NewAuthenticatedRequest(t, http.MethodPut, fmt.Sprintf("/devices/%d", device.ID),
		map[string]string{"device_id": device.DeviceID, "device_type": "terminal", "status": "inactive"},
		testutil.WithClaims(t, testutil.DefaultTestClaims()),
		testutil.WithPermissions("iot:update"),
	)

	rr := testutil.ExecuteRequest(f.router, req)

	require.Equal(t, http.StatusOK, rr.Code, rr.Body.String())
	entries := auditEntriesOf(t, f.audit, "device_status")
	require.Len(t, entries, 1)
	assert.Equal(t, "blocked", entries[0]["outcome"])
	assert.Equal(t, "active", entries[0]["from_status"])
}

func TestDeviceBlockingStaysInsideTheSchoolAndNeedsThePermission(t *testing.T) {
	t.Parallel()
	f := newDeviceBlockingFixture(t)
	otherTenant, _ := testpkg.CreateTestTenant(t, f.db)
	foreign := testpkg.CreateTestDeviceForTenant(t, f.db, otherTenant, "blocking-foreign")
	own := testpkg.CreateTestDevice(t, f.db, "blocking-own")

	testutil.AssertNotFound(t, f.setStatus(t, foreign.DeviceID, "inactive"))
	assert.Equal(t, devicefleet.DeviceStatusActive, devicefleet.DeviceStatus(f.stored(t, foreign.ID).Status), "another school's device stays usable")

	denied := f.setStatus(t, own.DeviceID, "inactive", "iot:read")
	assert.Equal(t, http.StatusForbidden, denied.Code, denied.Body.String())
	assert.Equal(t, devicefleet.DeviceStatusActive, devicefleet.DeviceStatus(f.stored(t, own.ID).Status))

	manual := testpkg.EnsureWebManualDevice(t, f.db)
	assert.Equal(t, http.StatusForbidden, f.setStatus(t, manual.DeviceID, "inactive").Code, "the manual web check-in device cannot be blocked")
	assert.Empty(t, auditEntriesOf(t, f.audit, "device_status"))
}
