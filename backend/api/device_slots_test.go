//go:build testhooks

package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/api/testutil"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// deviceSlotSummary is the wire answer of GET /device-slots.
type deviceSlotSummary struct {
	DeviceSlots *int `json:"device_slots"`
	Occupied    int  `json:"occupied"`
	Free        *int `json:"free"`
}

func (f deviceRemovalFixture) slotSummary(t *testing.T, permissions ...string) (deviceSlotSummary, *httptest.ResponseRecorder) {
	t.Helper()
	claims := testutil.DefaultTestClaims()
	claims.Roles, claims.Permissions, claims.IsAdmin = []string{"user"}, permissions, false
	req := testutil.NewAuthenticatedRequest(t, http.MethodGet, "/api/iot/device-slots", nil,
		testutil.WithClaims(t, claims), testutil.WithPermissions(permissions...))
	rr := testutil.ExecuteRequest(f.router, req)
	var envelope struct {
		Data deviceSlotSummary `json:"data"`
	}
	if rr.Code == http.StatusOK {
		require.NoError(t, json.Unmarshal(rr.Body.Bytes(), &envelope), rr.Body.String())
	}
	return envelope.Data, rr
}

func (f deviceRemovalFixture) register(t *testing.T, deviceID string, permissions ...string) *httptest.ResponseRecorder {
	t.Helper()
	claims := testutil.DefaultTestClaims()
	claims.Roles, claims.Permissions, claims.IsAdmin = []string{"user"}, permissions, false
	req := testutil.NewAuthenticatedRequest(t, http.MethodPost, "/api/iot/",
		map[string]string{"device_id": deviceID, "device_type": "rfid_reader"},
		testutil.WithClaims(t, claims), testutil.WithPermissions(permissions...))
	return testutil.ExecuteRequest(f.router, req)
}

func setDeviceSlots(t *testing.T, f deviceRemovalFixture, tenantID int64, slots *int) {
	t.Helper()
	_, err := f.db.NewUpdate().TableExpr("platform.schools").Set("device_slots = ?", slots).Where("id = ?", tenantID).Exec(context.Background())
	require.NoError(t, err)
}

// TestDeviceSlotsSchoolPortal covers the school's view of its Geräteplätze
// (#2312): devices:read shows occupied and free places, blocked devices keep
// theirs, the system device and removed devices take none, and a
// registration beyond the limit is refused with the limit in the answer.
func TestDeviceSlotsSchoolPortal(t *testing.T) {
	t.Parallel()
	f := deviceFixtureOn(t, testpkg.SetupTestDB(t))
	first := testpkg.CreateTestDevice(t, f.db, "slots-first")
	blocked := testpkg.CreateTestDevice(t, f.db, "slots-blocked")
	removed := testpkg.CreateTestDevice(t, f.db, "slots-removed")
	testpkg.EnsureWebManualDevice(t, f.db)
	tenantID := first.TenantID
	require.Equal(t, http.StatusOK, f.setStatus(t, blocked.DeviceID, "inactive").Code)
	require.Equal(t, http.StatusOK, f.remove(t, removed.ID).Code)

	summary, rr := f.slotSummary(t, "devices:read")
	require.Equal(t, http.StatusOK, rr.Code, rr.Body.String())
	assert.Equal(t, deviceSlotSummary{Occupied: 2}, summary, "without a limit there is no free count")

	three := 3
	setDeviceSlots(t, f, tenantID, &three)
	summary, _ = f.slotSummary(t, "devices:read")
	require.NotNil(t, summary.DeviceSlots)
	require.NotNil(t, summary.Free)
	assert.Equal(t, 3, *summary.DeviceSlots)
	assert.Equal(t, 2, summary.Occupied, "the blocked device keeps its place, the removed one released it")
	assert.Equal(t, 1, *summary.Free)

	denied := f.register(t, "slots-reader", "devices:read")
	assert.Equal(t, http.StatusForbidden, denied.Code, "devices:read registers nothing")

	createdEvents := func() int {
		var n int
		require.NoError(t, f.db.NewRaw(`SELECT count(*) FROM audit.device_lifecycle_events WHERE tenant_id = ? AND action = 'created'`,
			tenantID).Scan(context.Background(), &n))
		return n
	}
	eventsBefore := createdEvents()
	created := f.register(t, "slots-last", "devices:manage")
	require.Equal(t, http.StatusCreated, created.Code, created.Body.String())
	require.Equal(t, eventsBefore+1, createdEvents(), "a registration within the limit is in the device history")
	eventsBefore++

	full := f.register(t, "slots-beyond", "devices:manage")
	require.Equal(t, http.StatusConflict, full.Code, full.Body.String())
	assert.Contains(t, full.Body.String(), `"code":"iot.device_slots_full"`)
	assert.Contains(t, full.Body.String(), `"device_slots":3`)
	summary, _ = f.slotSummary(t, "devices:read")
	assert.Equal(t, 3, summary.Occupied, "the refused registration left no device")
	assert.Equal(t, eventsBefore, createdEvents(), "the refused registration left no history entry")
	assert.Equal(t, 0, *summary.Free)

	duplicate := f.register(t, first.DeviceID, "devices:manage")
	require.Equal(t, http.StatusConflict, duplicate.Code, duplicate.Body.String())

	_, noPermission := f.slotSummary(t, "users:read")
	assert.Equal(t, http.StatusForbidden, noPermission.Code)
}

// TestDeviceSlotsStayInsideTheSchool proves that a school reads only its own
// Geräteplätze and that a taken device ID stays a field conflict.
func TestDeviceSlotsStayInsideTheSchool(t *testing.T) {
	t.Parallel()
	f := deviceFixtureOn(t, testpkg.SetupTestDB(t))
	own := testpkg.CreateTestDevice(t, f.db, "slots-own")
	otherTenant, _ := testpkg.CreateTestTenant(t, f.db)
	testpkg.CreateTestDeviceForTenant(t, f.db, otherTenant, "slots-foreign-a")
	testpkg.CreateTestDeviceForTenant(t, f.db, otherTenant, "slots-foreign-b")
	five, nine := 5, 9
	setDeviceSlots(t, f, own.TenantID, &five)
	setDeviceSlots(t, f, otherTenant, &nine)

	summary, rr := f.slotSummary(t, "devices:read")

	require.Equal(t, http.StatusOK, rr.Code, rr.Body.String())
	require.NotNil(t, summary.DeviceSlots)
	assert.Equal(t, 5, *summary.DeviceSlots, "the school sees its own limit")
	assert.Equal(t, 1, summary.Occupied, "another school's devices are not counted")

	duplicate := f.register(t, own.DeviceID, "devices:manage")
	require.Equal(t, http.StatusConflict, duplicate.Code, duplicate.Body.String())
	assert.Contains(t, duplicate.Body.String(), `"code":"iot.device_id_taken"`)
}

// TestDeviceSlotsRegistrationWaitsForALoweredLimit holds the Geräteplatz lock
// in an operator transaction that lowers the limit to the registered devices
// while a registration waits for the lock (#2312): once the operator commits,
// the registration must see the lowered limit and be refused.
func TestDeviceSlotsRegistrationWaitsForALoweredLimit(t *testing.T) {
	t.Parallel()
	f := deviceFixtureOn(t, testpkg.SetupTestDB(t))
	existing := testpkg.CreateTestDevice(t, f.db, "slots-race-existing")
	five := 5
	setDeviceSlots(t, f, existing.TenantID, &five)
	ctx := context.Background()

	operator, err := f.db.BeginTx(ctx, nil)
	require.NoError(t, err)
	defer func() { _ = operator.Rollback() }()
	_, err = operator.ExecContext(ctx, `SELECT pg_advisory_xact_lock(?, ?)`, int32(0x67657261), int32(existing.TenantID))
	require.NoError(t, err)
	_, err = operator.ExecContext(ctx, `UPDATE platform.schools SET device_slots = 1 WHERE id = ?`, existing.TenantID)
	require.NoError(t, err)

	done := make(chan *httptest.ResponseRecorder, 1)
	go func() { done <- f.register(t, "slots-race-new", "devices:manage") }()
	require.Eventually(t, func() bool {
		var waiting int
		_ = f.db.NewRaw(`SELECT count(*) FROM pg_locks WHERE locktype = 'advisory' AND NOT granted AND objid = ?`,
			existing.TenantID).Scan(ctx, &waiting)
		return waiting > 0
	}, 10*time.Second, 20*time.Millisecond, "the registration waits for the Geräteplatz lock")
	require.NoError(t, operator.Commit())

	rr := <-done
	require.Equal(t, http.StatusConflict, rr.Code, rr.Body.String())
	assert.Contains(t, rr.Body.String(), `"code":"iot.device_slots_full"`)
	assert.Contains(t, rr.Body.String(), `"device_slots":1`)
}

// TestDeviceManagementNeedsDevicesManage sends every device-management route
// of the school portal with devices:read only (#2312): each is refused and
// changes nothing.
func TestDeviceManagementNeedsDevicesManage(t *testing.T) {
	t.Parallel()
	f := deviceFixtureOn(t, testpkg.SetupTestDB(t))
	device := testpkg.CreateTestDevice(t, f.db, "slots-reader")
	claims := testutil.DefaultTestClaims()
	claims.Roles, claims.Permissions, claims.IsAdmin = []string{"user"}, []string{"devices:read"}, false

	for _, route := range []struct{ method, path string }{
		{http.MethodPost, "/api/iot/"},
		{http.MethodPut, fmt.Sprintf("/api/iot/%d", device.ID)},
		{http.MethodDelete, fmt.Sprintf("/api/iot/%d", device.ID)},
		{http.MethodPatch, "/api/iot/" + device.DeviceID + "/status"},
		{http.MethodPost, "/api/iot/" + device.DeviceID + "/ping"},
		{http.MethodPost, "/api/iot/detect-new"},
		{http.MethodPost, "/api/iot/scan-network"},
	} {
		req := testutil.NewAuthenticatedRequest(t, route.method, route.path,
			map[string]string{"device_id": "x", "device_type": "rfid_reader", "status": "inactive"},
			testutil.WithClaims(t, claims), testutil.WithPermissions("devices:read"))
		rr := testutil.ExecuteRequest(f.router, req)
		assert.Equal(t, http.StatusForbidden, rr.Code, "%s %s: %s", route.method, route.path, rr.Body.String())
	}
	stored := f.stored(t, device.ID)
	assert.Nil(t, stored.ArchivedAt)
	assert.Equal(t, "active", stored.Status)
}
