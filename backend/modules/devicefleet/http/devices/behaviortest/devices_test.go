package devices_test

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/devicefleet"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"

	"github.com/moto-ogs/project-phoenix/api/testutil"
	devices "github.com/moto-ogs/project-phoenix/modules/devicefleet/http/devices"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// testContext holds shared test dependencies.
type testContext struct {
	db       *bun.DB
	resource *devices.Resource
}

// setupDevicesModule initializes the devices route.
func setupDevicesModule(t *testing.T) *testContext {
	t.Helper()

	db, fleet := composeDeviceFleet(t)

	resource := devices.NewResource(devicefleet.NewAdministration(fleet, time.Now), testRuntime(fleet))

	return &testContext{
		db:       db,
		resource: resource,
	}
}

// =============================================================================
// LIST DEVICES TESTS
// =============================================================================

func TestListDevices_Success(t *testing.T) {
	t.Parallel()
	ctx := setupDevicesModule(t)

	router := testutil.NewTenantRouter(ctx.db)
	router.Mount("/devices", ctx.resource.Router())

	req := testutil.NewAuthenticatedRequest(t, "GET", "/devices", nil,
		testutil.WithClaims(t, testutil.DefaultTestClaims()),
		testutil.WithPermissions("devices:read"),
	)

	rr := testutil.ExecuteRequest(router, req)

	testutil.AssertSuccessResponse(t, rr, http.StatusOK)
}

func TestListDevices_WithTypeFilter(t *testing.T) {
	t.Parallel()
	ctx := setupDevicesModule(t)

	router := testutil.NewTenantRouter(ctx.db)
	router.Mount("/devices", ctx.resource.Router())

	req := testutil.NewAuthenticatedRequest(t, "GET", "/devices?device_type=terminal", nil,
		testutil.WithClaims(t, testutil.DefaultTestClaims()),
		testutil.WithPermissions("devices:read"),
	)

	rr := testutil.ExecuteRequest(router, req)

	testutil.AssertSuccessResponse(t, rr, http.StatusOK)
}

func TestListDevices_WithStatusFilter(t *testing.T) {
	t.Parallel()
	ctx := setupDevicesModule(t)

	router := testutil.NewTenantRouter(ctx.db)
	router.Mount("/devices", ctx.resource.Router())

	req := testutil.NewAuthenticatedRequest(t, "GET", "/devices?status=active", nil,
		testutil.WithClaims(t, testutil.DefaultTestClaims()),
		testutil.WithPermissions("devices:read"),
	)

	rr := testutil.ExecuteRequest(router, req)

	testutil.AssertSuccessResponse(t, rr, http.StatusOK)
}

func TestListDevices_WithSearchFilter(t *testing.T) {
	t.Parallel()
	ctx := setupDevicesModule(t)

	router := testutil.NewTenantRouter(ctx.db)
	router.Mount("/devices", ctx.resource.Router())

	req := testutil.NewAuthenticatedRequest(t, "GET", "/devices?search=test", nil,
		testutil.WithClaims(t, testutil.DefaultTestClaims()),
		testutil.WithPermissions("devices:read"),
	)

	rr := testutil.ExecuteRequest(router, req)

	testutil.AssertSuccessResponse(t, rr, http.StatusOK)
}

// =============================================================================
// GET DEVICE TESTS
// =============================================================================

func TestGetDevice_Success(t *testing.T) {
	t.Parallel()
	ctx := setupDevicesModule(t)

	// Create test device
	uniqueID := fmt.Sprintf("test-device-%d", time.Now().UnixNano())
	device := testpkg.CreateTestDevice(t, ctx.db, uniqueID)

	router := testutil.NewTenantRouter(ctx.db)
	router.Mount("/devices", ctx.resource.Router())

	req := testutil.NewAuthenticatedRequest(t, "GET", fmt.Sprintf("/devices/%d", device.ID), nil,
		testutil.WithClaims(t, testutil.DefaultTestClaims()),
		testutil.WithPermissions("devices:read"),
	)

	rr := testutil.ExecuteRequest(router, req)

	testutil.AssertSuccessResponse(t, rr, http.StatusOK)
}

func TestGetDevice_NotFound(t *testing.T) {
	t.Parallel()
	ctx := setupDevicesModule(t)

	router := testutil.NewTenantRouter(ctx.db)
	router.Mount("/devices", ctx.resource.Router())

	req := testutil.NewAuthenticatedRequest(t, "GET", "/devices/999999", nil,
		testutil.WithClaims(t, testutil.DefaultTestClaims()),
		testutil.WithPermissions("devices:read"),
	)

	rr := testutil.ExecuteRequest(router, req)

	testutil.AssertNotFound(t, rr)
}

func TestGetDevice_InvalidID(t *testing.T) {
	t.Parallel()
	ctx := setupDevicesModule(t)

	router := testutil.NewTenantRouter(ctx.db)
	router.Mount("/devices", ctx.resource.Router())

	req := testutil.NewAuthenticatedRequest(t, "GET", "/devices/invalid", nil,
		testutil.WithClaims(t, testutil.DefaultTestClaims()),
		testutil.WithPermissions("devices:read"),
	)

	rr := testutil.ExecuteRequest(router, req)

	testutil.AssertBadRequest(t, rr)
}

// =============================================================================
// GET DEVICE BY DEVICE ID TESTS
// =============================================================================

// =============================================================================
// CREATE DEVICE TESTS
// =============================================================================

func TestCreateDevice_Success(t *testing.T) {
	t.Parallel()
	ctx := setupDevicesModule(t)

	router := testutil.NewTenantRouter(ctx.db)
	router.Mount("/devices", ctx.resource.Router())

	uniqueID := fmt.Sprintf("new-device-%d", time.Now().UnixNano())
	body := map[string]interface{}{
		"device_id":   uniqueID,
		"device_type": "terminal",
		"name":        "Test Device",
	}

	req := testutil.NewAuthenticatedRequest(t, "POST", "/devices", body,
		testutil.WithClaims(t, testutil.DefaultTestClaims()),
		testutil.WithPermissions("devices:manage"),
	)

	rr := testutil.ExecuteRequest(router, req)

	testutil.AssertSuccessResponse(t, rr, http.StatusCreated)
	var created struct {
		Data struct {
			ID     ident.ID `json:"id"`
			APIKey string   `json:"api_key"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(rr.Body.Bytes(), &created))
	require.True(t, created.Data.APIKey != "", "device creation must issue the one-time credential for provisioning")
	require.Equal(t, "no-store", rr.Header().Get("Cache-Control"))
	read := testutil.NewAuthenticatedRequest(t, "GET", fmt.Sprintf("/devices/%d", created.Data.ID), nil,
		testutil.WithClaims(t, testutil.DefaultTestClaims()), testutil.WithPermissions("devices:read"))
	found := testutil.ExecuteRequest(router, read)
	testutil.AssertSuccessResponse(t, found, http.StatusOK)
	require.False(t, strings.Contains(found.Body.String(), `"api_key"`), "a later HTTP read must not repeat the credential")
}

func TestCreateDevice_NewDeviceHasNoRoom(t *testing.T) {
	t.Parallel()
	ctx := setupDevicesModule(t)

	router := testutil.NewTenantRouter(ctx.db)
	router.Mount("/devices", ctx.resource.Router())

	uniqueID := fmt.Sprintf("new-device-no-room-%d", time.Now().UnixNano())
	body := map[string]interface{}{
		"device_id":   uniqueID,
		"device_type": "terminal",
		"name":        "Device Without Room",
	}

	req := testutil.NewAuthenticatedRequest(t, "POST", "/devices", body,
		testutil.WithClaims(t, testutil.DefaultTestClaims()),
		testutil.WithPermissions("devices:manage"),
	)

	rr := testutil.ExecuteRequest(router, req)

	testutil.AssertSuccessResponse(t, rr, http.StatusCreated)

	response := testutil.ParseJSONResponse(t, rr.Body.Bytes())
	data := response["data"].(map[string]interface{})

	// A newly created device has no room — location is auto-derived from sessions
	assert.Nil(t, data["room_name"], "new device should have no room_name before any session")
}

func TestCreateDevice_MissingDeviceID(t *testing.T) {
	t.Parallel()
	ctx := setupDevicesModule(t)

	router := testutil.NewTenantRouter(ctx.db)
	router.Mount("/devices", ctx.resource.Router())

	body := map[string]interface{}{
		"device_type": "terminal",
		"name":        "Test Device",
	}

	req := testutil.NewAuthenticatedRequest(t, "POST", "/devices", body,
		testutil.WithClaims(t, testutil.DefaultTestClaims()),
		testutil.WithPermissions("devices:manage"),
	)

	rr := testutil.ExecuteRequest(router, req)

	testutil.AssertBadRequest(t, rr)
}

func TestCreateDevice_MissingDeviceType(t *testing.T) {
	t.Parallel()
	ctx := setupDevicesModule(t)

	router := testutil.NewTenantRouter(ctx.db)
	router.Mount("/devices", ctx.resource.Router())

	uniqueID := fmt.Sprintf("new-device-%d", time.Now().UnixNano())
	body := map[string]interface{}{
		"device_id": uniqueID,
		"name":      "Test Device",
	}

	req := testutil.NewAuthenticatedRequest(t, "POST", "/devices", body,
		testutil.WithClaims(t, testutil.DefaultTestClaims()),
		testutil.WithPermissions("devices:manage"),
	)

	rr := testutil.ExecuteRequest(router, req)

	testutil.AssertBadRequest(t, rr)
}

// =============================================================================
// UPDATE DEVICE TESTS
// =============================================================================

func TestUpdateDevice_Success(t *testing.T) {
	t.Parallel()
	ctx := setupDevicesModule(t)

	// Create test device
	uniqueID := fmt.Sprintf("update-device-%d", time.Now().UnixNano())
	device := testpkg.CreateTestDevice(t, ctx.db, uniqueID)

	router := testutil.NewTenantRouter(ctx.db)
	router.Mount("/devices", ctx.resource.Router())

	body := map[string]interface{}{
		"device_id":        uniqueID,
		"device_type":      "terminal",
		"name":             "Updated Device Name",
		"expected_version": deviceVersion(t, router, fmt.Sprintf("/devices/%d", device.ID)),
	}

	req := testutil.NewAuthenticatedRequest(t, "PUT", fmt.Sprintf("/devices/%d", device.ID), body,
		testutil.WithClaims(t, testutil.DefaultTestClaims()),
		testutil.WithPermissions("devices:manage"),
	)

	rr := testutil.ExecuteRequest(router, req)

	testutil.AssertSuccessResponse(t, rr, http.StatusOK)
}

func TestUpdateDevice_PreservesSessionDerivedRoom(t *testing.T) {
	t.Parallel()
	ctx := setupDevicesModule(t)

	device := testpkg.CreateTestDevice(t, ctx.db, "update-room-device")
	room := testpkg.CreateTestRoom(t, ctx.db, "UpdateDevice-SessionRoom")

	// Simulate a session having set the device's room_id (as auto-derive would)
	_, err := ctx.db.NewUpdate().
		Model(device).
		ModelTableExpr(`iot.devices`).
		Set("room_id = ?", room.ID).
		Where("id = ?", device.ID).
		Exec(testpkg.Ctx(t))
	assert.NoError(t, err)

	router := testutil.NewTenantRouter(ctx.db)
	router.Mount("/devices", ctx.resource.Router())

	// Update only the name — room_id is not in the request (auto-derived, not manual)
	body := map[string]interface{}{
		"device_id":        device.DeviceID,
		"device_type":      device.DeviceType,
		"name":             "Updated Device Name",
		"expected_version": deviceVersion(t, router, fmt.Sprintf("/devices/%d", device.ID)),
	}

	req := testutil.NewAuthenticatedRequest(t, "PUT", fmt.Sprintf("/devices/%d", device.ID), body,
		testutil.WithClaims(t, testutil.DefaultTestClaims()),
		testutil.WithPermissions("devices:manage"),
	)

	rr := testutil.ExecuteRequest(router, req)

	testutil.AssertSuccessResponse(t, rr, http.StatusOK)

	response := testutil.ParseJSONResponse(t, rr.Body.Bytes())
	data := response["data"].(map[string]interface{})

	// The session-derived room should be preserved after updating other fields
	assert.Equal(t, room.Name, data["room_name"])
}

func TestUpdateDevice_NotFound(t *testing.T) {
	t.Parallel()
	ctx := setupDevicesModule(t)

	router := testutil.NewTenantRouter(ctx.db)
	router.Mount("/devices", ctx.resource.Router())

	body := map[string]interface{}{
		"device_id":   "test",
		"device_type": "terminal",
		"name":        "Test",
	}

	req := testutil.NewAuthenticatedRequest(t, "PUT", "/devices/999999", body,
		testutil.WithClaims(t, testutil.DefaultTestClaims()),
		testutil.WithPermissions("devices:manage"),
	)

	rr := testutil.ExecuteRequest(router, req)

	testutil.AssertNotFound(t, rr)
}

func TestUpdateDevice_InvalidID(t *testing.T) {
	t.Parallel()
	ctx := setupDevicesModule(t)

	router := testutil.NewTenantRouter(ctx.db)
	router.Mount("/devices", ctx.resource.Router())

	body := map[string]interface{}{
		"device_id":   "test",
		"device_type": "terminal",
	}

	req := testutil.NewAuthenticatedRequest(t, "PUT", "/devices/invalid", body,
		testutil.WithClaims(t, testutil.DefaultTestClaims()),
		testutil.WithPermissions("devices:manage"),
	)

	rr := testutil.ExecuteRequest(router, req)

	testutil.AssertBadRequest(t, rr)
}

// =============================================================================
// DELETE DEVICE TESTS
// =============================================================================

func TestDeleteDevice_Success(t *testing.T) {
	t.Parallel()
	ctx := setupDevicesModule(t)

	// Create test device
	uniqueID := fmt.Sprintf("delete-device-%d", time.Now().UnixNano())
	device := testpkg.CreateTestDevice(t, ctx.db, uniqueID)
	// Note: No defer cleanup needed since we're deleting it

	router := testutil.NewTenantRouter(ctx.db)
	router.Mount("/devices", ctx.resource.Router())

	req := testutil.NewAuthenticatedRequest(t, "DELETE", fmt.Sprintf("/devices/%d", device.ID), nil,
		testutil.WithClaims(t, testutil.DefaultTestClaims()),
		testutil.WithPermissions("devices:manage"),
	)

	rr := testutil.ExecuteRequest(router, req)

	testutil.AssertSuccessResponse(t, rr, http.StatusOK)
}

func TestDeleteDevice_NotFound(t *testing.T) {
	t.Parallel()
	ctx := setupDevicesModule(t)

	router := testutil.NewTenantRouter(ctx.db)
	router.Mount("/devices", ctx.resource.Router())

	req := testutil.NewAuthenticatedRequest(t, "DELETE", "/devices/999999", nil,
		testutil.WithClaims(t, testutil.DefaultTestClaims()),
		testutil.WithPermissions("devices:manage"),
	)

	rr := testutil.ExecuteRequest(router, req)

	testutil.AssertNotFound(t, rr)
}

func TestDeleteDevice_InvalidID(t *testing.T) {
	t.Parallel()
	ctx := setupDevicesModule(t)

	router := testutil.NewTenantRouter(ctx.db)
	router.Mount("/devices", ctx.resource.Router())

	req := testutil.NewAuthenticatedRequest(t, "DELETE", "/devices/invalid", nil,
		testutil.WithClaims(t, testutil.DefaultTestClaims()),
		testutil.WithPermissions("devices:manage"),
	)

	rr := testutil.ExecuteRequest(router, req)

	testutil.AssertBadRequest(t, rr)
}

// =============================================================================
// UPDATE DEVICE STATUS TESTS
// =============================================================================

func TestUpdateDeviceStatus_Success(t *testing.T) {
	t.Parallel()
	ctx := setupDevicesModule(t)

	// Create test device - use device.DeviceID which includes fixture's unique suffix
	device := testpkg.CreateTestDevice(t, ctx.db, "status-device")

	router := testutil.NewTenantRouter(ctx.db)
	router.Mount("/devices", ctx.resource.Router())

	body := map[string]interface{}{
		"status": "maintenance",
	}

	req := testutil.NewAuthenticatedRequest(t, "PATCH", fmt.Sprintf("/devices/%s/status", device.DeviceID), body,
		testutil.WithClaims(t, testutil.DefaultTestClaims()),
		testutil.WithPermissions("devices:manage"),
	)

	rr := testutil.ExecuteRequest(router, req)

	testutil.AssertSuccessResponse(t, rr, http.StatusOK)
}

func TestUpdateDeviceStatus_MissingStatus(t *testing.T) {
	t.Parallel()
	ctx := setupDevicesModule(t)

	// Create test device - use device.DeviceID which includes fixture's unique suffix
	device := testpkg.CreateTestDevice(t, ctx.db, "status-missing")

	router := testutil.NewTenantRouter(ctx.db)
	router.Mount("/devices", ctx.resource.Router())

	body := map[string]interface{}{}

	req := testutil.NewAuthenticatedRequest(t, "PATCH", fmt.Sprintf("/devices/%s/status", device.DeviceID), body,
		testutil.WithClaims(t, testutil.DefaultTestClaims()),
		testutil.WithPermissions("devices:manage"),
	)

	rr := testutil.ExecuteRequest(router, req)

	testutil.AssertBadRequest(t, rr)
}

// =============================================================================
// PING DEVICE TESTS
// =============================================================================

// =============================================================================
// GET DEVICES BY TYPE TESTS
// =============================================================================

// =============================================================================
// GET DEVICES BY STATUS TESTS
// =============================================================================

// =============================================================================
// GET DEVICES BY REGISTERED BY TESTS
// =============================================================================

// =============================================================================
// GET ACTIVE DEVICES TESTS
// =============================================================================

// =============================================================================
// GET DEVICES REQUIRING MAINTENANCE TESTS
// =============================================================================

// =============================================================================
// GET OFFLINE DEVICES TESTS
// =============================================================================

// =============================================================================
// GET DEVICE STATISTICS TESTS
// =============================================================================

// =============================================================================
// DETECT NEW DEVICES TESTS
// =============================================================================

// =============================================================================
// SCAN NETWORK TESTS
// =============================================================================
