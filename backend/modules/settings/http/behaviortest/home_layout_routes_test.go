package settingshttp_test

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/api/testutil"
	"github.com/moto-ogs/project-phoenix/modules/settings/records"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// A person arranges the start page, the school prescribes a block, the
// person returns to the recommended page, and the admin reads that the
// tablets still need a PIN: every route under /api/settings through the real
// resource with the server's chains.
func TestSettingsStartPageRoutesStoreWhatTheyAnswer(t *testing.T) {
	t.Parallel()
	f := newSettingsBudgetFixture(t, testpkg.SetupTestDB(t))
	token := testutil.MintTestJWT(t, f.admin)
	send := func(method, path string, body any) *http.Response {
		t.Helper()
		req := testutil.NewAuthenticatedRequest(t, method, path, body, testutil.WithJWTBearer(token))
		req.RemoteAddr = "127.0.0.1:12345"
		return testutil.ExecuteRequestForTest(t, f.router, req).Result()
	}
	read := func() map[string]any {
		t.Helper()
		rec := f.get(t, "/api/settings/home-layout", token)
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		var out struct {
			Data map[string]any `json:"data"`
		}
		require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &out))
		return out.Data
	}

	response := send(http.MethodPut, "/api/settings/home-layout", map[string]any{
		"overrides": map[string]bool{"section.birthdays": false},
		"blocks":    []map[string]any{{"key": "section.staff_notices", "span": 2, "col": 0, "row": 0}},
	})
	require.Equal(t, http.StatusOK, response.StatusCode)
	assert.Equal(t, map[string]any{"section.birthdays": false}, read()["overrides"])

	read0 := read()["policies_version"]
	require.NotEmpty(t, read0, "the layout read carries the prescription's version")
	response = send(http.MethodPut, "/api/settings/home-layout/policies", map[string]any{
		"policies":         map[string]string{"section.staff_notices": "required"},
		"expected_version": read0,
	})
	require.Equal(t, http.StatusOK, response.StatusCode)
	// That read is outdated now (ADR 0311): the school's prescription stays.
	response = send(http.MethodPut, "/api/settings/home-layout/policies", map[string]any{
		"policies":         map[string]string{"section.staff_notices": "disabled"},
		"expected_version": read0,
	})
	require.Equal(t, http.StatusConflict, response.StatusCode)
	var refusal struct {
		Code string `json:"code"`
	}
	require.NoError(t, json.NewDecoder(response.Body).Decode(&refusal))
	_ = response.Body.Close()
	assert.Equal(t, "general.changed_since_read", refusal.Code)
	response = send(http.MethodDelete, "/api/settings/home-layout", nil)
	require.Equal(t, http.StatusNoContent, response.StatusCode)
	layout := read()
	assert.Empty(t, layout["overrides"], "the reset drops the person's deviations")
	assert.Equal(t, map[string]any{"section.staff_notices": "required"}, layout["policies"])

	rec := f.get(t, "/api/settings/device-pin-status", token)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	var status struct {
		Data struct {
			SetupRequired bool   `json:"setup_required"`
			Reason        string `json:"reason"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &status))
	assert.True(t, status.Data.SetupRequired, "a school without a PIN of its own must set one")
	assert.Equal(t, records.DevicePINMissing, status.Data.Reason)
}
