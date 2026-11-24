package devices_test

import (
	"encoding/json"
	"fmt"
	"net/http"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/api/testutil"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// deviceVersion reads the version of a device the way the edit form reads
// it: through GET {prefix}/{id} (ADR 0311).
func deviceVersion(t *testing.T, router chi.Router, path string) string {
	t.Helper()
	req := testutil.NewAuthenticatedRequest(t, http.MethodGet, path, nil,
		testutil.WithClaims(t, testutil.DefaultTestClaims()), testutil.WithPermissions("devices:read"))
	rr := testutil.ExecuteRequest(router, req)
	require.Equal(t, http.StatusOK, rr.Code, rr.Body.String())
	var envelope struct {
		Data struct {
			Version string `json:"version"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(rr.Body.Bytes(), &envelope))
	require.NotEmpty(t, envelope.Data.Version, "the device read carries its version")
	return envelope.Data.Version
}

// An edit of a device saves what its editor read: an edit from an older read
// is refused with 409 and writes nothing, an edit without a version too; the
// current version saves and answers the next one. The root's renderer gives
// the refusal its code general.changed_since_read
// (api.TestDeviceManagementAnswersItsContract).
func TestUpdateDevice_RefusesAnEditOfAnOlderRead(t *testing.T) {
	t.Parallel()
	ctx := setupDevicesModule(t)
	device := testpkg.CreateTestDevice(t, ctx.db, fmt.Sprintf("read-state-%d", time.Now().UnixNano()))
	router := testutil.NewTenantRouter(ctx.db)
	router.Mount("/devices", ctx.resource.Router())
	path := fmt.Sprintf("/devices/%d", device.ID)
	put := func(name, version string) (int, string, []byte) {
		req := testutil.NewAuthenticatedRequest(t, http.MethodPut, path, map[string]any{
			"device_id": device.DeviceID, "device_type": device.DeviceType, "name": name, "expected_version": version,
		}, testutil.WithClaims(t, testutil.DefaultTestClaims()), testutil.WithPermissions("devices:manage"))
		rr := testutil.ExecuteRequest(router, req)
		var envelope struct {
			Code string `json:"code"`
			Data struct {
				Version string `json:"version"`
			} `json:"data"`
		}
		require.NoError(t, json.Unmarshal(rr.Body.Bytes(), &envelope), rr.Body.String())
		if envelope.Code == "" {
			return rr.Code, envelope.Data.Version, rr.Body.Bytes()
		}
		return rr.Code, envelope.Code, rr.Body.Bytes()
	}
	storedName := func() string {
		var name *string
		require.NoError(t, ctx.db.NewRaw(`SELECT name FROM iot.devices WHERE id = ?`, device.ID).Scan(testpkg.Ctx(t), &name))
		require.NotNil(t, name)
		return *name
	}

	read := deviceVersion(t, router, path)
	// Another editor renames the device after this read.
	_, err := ctx.db.NewRaw(`UPDATE iot.devices SET name = 'Von jemand anderem' WHERE id = ?`, device.ID).Exec(testpkg.Ctx(t))
	require.NoError(t, err)

	status, _, body := put("Überholt", read)
	assert.Equal(t, http.StatusConflict, status, string(body))
	status, _, body = put("Ohne Stand", "")
	assert.Equal(t, http.StatusConflict, status, string(body))
	assert.Equal(t, "Von jemand anderem", storedName(), "a refused edit writes nothing")

	current := deviceVersion(t, router, path)
	status, answered, body := put("Aktuell", current)
	require.Equal(t, http.StatusOK, status, string(body))
	assert.Equal(t, "Aktuell", storedName())
	assert.Equal(t, deviceVersion(t, router, path), answered, "the answer carries the stored version")
	status, _, body = put("Zweites Speichern", answered)
	assert.Equal(t, http.StatusOK, status, "a second save on the answered version: %s", body)
}
