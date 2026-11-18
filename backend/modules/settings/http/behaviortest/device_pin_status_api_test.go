// Router-level tests for GET /api/settings/device-pin-status (#7175): the
// school admin learns whether the tablets still need a PIN of the school's own.
// The answer is a flag only; the PIN never leaves the reveal endpoint.
package settingshttp_test

import (
	"context"
	"testing"

	"github.com/moto-ogs/project-phoenix/api/testutil"
	"github.com/moto-ogs/project-phoenix/modules/settings/records"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestDevicePINStatusAPI(t *testing.T) {
	t.Parallel()
	ctx := setupSettingsModule(t)
	router := ctx.resource.SettingsRouter()

	status := func(t *testing.T) string {
		t.Helper()
		req := testutil.NewAuthenticatedRequest(t, "GET", "/device-pin-status", nil, testutil.WithTestTenant(t))
		rr := testutil.ExecuteRequest(router, req)
		testutil.AssertSuccessResponse(t, rr, 200)
		return rr.Body.String()
	}
	override := func(t *testing.T, key, jsonValue string) {
		t.Helper()
		testpkg.SetTestTenantSetting(t, ctx.db, testpkg.Tenant(t), key, jsonValue)
	}

	// A new school has NFC booked and no PIN: the tablets cannot sign in yet.
	body := status(t)
	assert.Contains(t, body, `"setup_required":true`)
	assert.Contains(t, body, `"reason":"missing"`)

	// The former default stays usable for existing schools (migration), but
	// the admin is asked to replace it.
	override(t, records.KeyOGSDevicePIN, `"1234"`)
	body = status(t)
	assert.Contains(t, body, `"setup_required":true`)
	assert.Contains(t, body, `"reason":"too_simple"`)
	assert.NotContains(t, body, "1234", "the status never carries the PIN")

	// The school's own PIN ends the notice.
	put := testutil.NewAuthenticatedRequest(t, "PUT", "/values/"+records.KeyOGSDevicePIN,
		map[string]any{"value": "4729"}, testutil.WithTestTenant(t))
	testutil.AssertSuccessResponse(t, testutil.ExecuteRequest(router, put), 200)
	body = status(t)
	assert.Contains(t, body, `"setup_required":false`)
	assert.NotContains(t, body, "reason")
	assert.NotContains(t, body, "4729", "the status never carries the PIN")
	schema := testutil.ExecuteRequest(router, testutil.NewAuthenticatedRequest(t, "GET", "/schema", nil, testutil.WithTestTenant(t)))
	testutil.AssertSuccessResponse(t, schema, 200)
	assert.NotContains(t, schema.Body.String(), "4729", "the schema masks the stored PIN")
	assert.Contains(t, schema.Body.String(), "••••••", "the stored PIN shows as a mask")

	// Without NFC-Anwesenheit there is no tablet to sign in to.
	override(t, records.KeyOGSDevicePIN, `""`)
	override(t, records.KeyModuleNFCAnwesenheit, `false`)
	assert.Contains(t, status(t), `"setup_required":false`)
}

// The former default and other easy guesses are refused and not stored.
func TestDevicePINRejectsTrivialValue(t *testing.T) {
	t.Parallel()
	ctx := setupSettingsModule(t)
	router := ctx.resource.SettingsRouter()

	put := testutil.NewAuthenticatedRequest(t, "PUT", "/values/"+records.KeyOGSDevicePIN,
		map[string]any{"value": "1234"}, testutil.WithTestTenant(t))
	testutil.AssertErrorResponse(t, testutil.ExecuteRequest(router, put), 400)

	count, err := ctx.db.NewSelect().Table("config.setting_values").
		Where("tenant_id = ?", testpkg.Tenant(t)).Where("setting_key = ?", records.KeyOGSDevicePIN).
		Count(context.Background())
	require.NoError(t, err)
	assert.Zero(t, count, "a refused PIN is not stored")
}
