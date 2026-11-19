package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/modules/identityaccess/sessiontoken"
	"github.com/moto-ogs/project-phoenix/modules/settings"
	"github.com/moto-ogs/project-phoenix/tenant"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// checkAnalyticsPolicyFollowsTheSchoolSetting drives GET /analytics-policy,
// which the root mounts beside every portal (#2352): a school-portal session
// reads its school's switch, a request without a session stays off, and the
// answer is the shared success envelope the catalog proxy decodes.
func checkAnalyticsPolicyFollowsTheSchoolSetting(t *testing.T, apiInstance *goldenRuntime) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	ctx := context.Background()
	school := func(enabled bool) int64 {
		t.Helper()
		id := testpkg.UniqueTestTenantID(t)
		testpkg.EnsureTestTenant(t, db, id)
		_, err := db.ExecContext(ctx, `
			INSERT INTO config.setting_values (tenant_id, setting_key, value) VALUES (?, ?, to_jsonb(?::boolean))
			ON CONFLICT (tenant_id, setting_key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`, id, settings.KeyAnalyticsEnabled, enabled)
		require.NoError(t, err)
		return id
	}
	on, off := school(true), school(false)

	policy := func(t *testing.T, schoolID int64) (bool, *httptest.ResponseRecorder) {
		t.Helper()
		request := httptest.NewRequest(http.MethodGet, "http://localhost/analytics-policy", nil)
		if schoolID != 0 {
			account := testpkg.CreateTestAccount(t, db, "lehrkraft-analyse")
			token := testpkg.MintLiveSessionJWT(t, db, sessiontoken.AppClaims{
				ID: int(account.ID), Sub: account.Email, Roles: []string{"lehrkraft"}, Scope: tenant.ScopeSchool, TenantID: schoolID, OrgID: 1,
			})
			request.Header.Set("Authorization", "Bearer "+token)
		}
		rec := httptest.NewRecorder()
		apiInstance.ServeHTTP(rec, request)
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		var answer struct {
			Status string `json:"status"`
			Data   struct {
				Enabled bool `json:"enabled"`
			} `json:"data"`
		}
		require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &answer))
		assert.Equal(t, "success", answer.Status)
		return answer.Data.Enabled, rec
	}

	enabled, rec := policy(t, on)
	assert.True(t, enabled, "the school switched the analytics on")
	assert.Equal(t, "no-store", rec.Header().Get("Cache-Control"))
	enabled, _ = policy(t, off)
	assert.False(t, enabled, "the school switched the analytics off")
	enabled, _ = policy(t, 0)
	assert.False(t, enabled, "without a session nothing is captured")
}
