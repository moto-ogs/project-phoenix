//go:build testhooks

package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/api/testutil"
)

// The device management the staff portal reaches through its catalog proxy
// (#7563) answers within its registered contract on the whole /api/iot
// pattern; the proxy turns a deviation into a 502. The kiosk's device API on
// the same mount stays outside the contract.
func TestDeviceManagementAnswersItsContract(t *testing.T) {
	t.Parallel()
	f := newDeviceRemovalFixture(t)
	exec := func(method, path string, body any) (int, []byte) {
		t.Helper()
		req := testutil.NewAuthenticatedRequest(t, method, path, body,
			testutil.WithClaims(t, testutil.DefaultTestClaims()),
			testutil.WithPermissions("devices:read", "devices:manage"))
		rr := testutil.ExecuteRequest(f.router, req)
		return rr.Code, rr.Body.Bytes()
	}

	code, body := exec(http.MethodPost, "/api/iot/", map[string]string{"device_id": "contract-terminal", "device_type": "terminal", "name": "Eingang"})
	require.Equal(t, http.StatusCreated, code, string(body))
	var created struct {
		Data struct {
			ID     wireID `json:"id"`
			APIKey string `json:"api_key"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(body, &created))
	require.NotZero(t, created.Data.ID)
	assert.NotEmpty(t, created.Data.APIKey, "the key is shown once, at creation")

	code, body = exec(http.MethodGet, "/api/iot/?device_type=terminal", nil)
	require.Equal(t, http.StatusOK, code, string(body))
	assert.Contains(t, string(body), `"device_id":"contract-terminal"`)

	device := fmt.Sprintf("/api/iot/%d", created.Data.ID)
	code, body = exec(http.MethodGet, device, nil)
	require.Equal(t, http.StatusOK, code, string(body))
	assert.NotContains(t, string(body), "api_key", "a read never carries the key")
	var read struct {
		Data struct {
			Version string `json:"version"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(body, &read))
	require.NotEmpty(t, read.Data.Version, "the read carries the version an edit sends back")

	code, body = exec(http.MethodPut, device, map[string]string{"device_id": "contract-terminal", "device_type": "terminal", "name": "Flur", "expected_version": read.Data.Version})
	require.Equal(t, http.StatusOK, code, string(body))
	assert.Contains(t, string(body), `"name":"Flur"`)
	// The read before that save is outdated now (ADR 0311).
	code, body = exec(http.MethodPut, device, map[string]string{"device_id": "contract-terminal", "device_type": "terminal", "name": "Gang", "expected_version": read.Data.Version})
	assert.Equal(t, http.StatusConflict, code, string(body))
	assert.Contains(t, string(body), `"code":"general.changed_since_read"`)

	code, body = exec(http.MethodGet, "/api/iot/device-slots", nil)
	require.Equal(t, http.StatusOK, code, string(body))

	code, body = exec(http.MethodDelete, device, nil)
	require.Equal(t, http.StatusOK, code, string(body))
	code, _ = exec(http.MethodGet, device, nil)
	assert.Equal(t, http.StatusNotFound, code, "a removed device is gone from the school's list")
}
