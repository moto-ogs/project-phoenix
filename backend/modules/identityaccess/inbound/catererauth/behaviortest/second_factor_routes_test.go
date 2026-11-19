//go:build testhooks

package catererauth_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/render"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/api"
	"github.com/moto-ogs/project-phoenix/api/testutil"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess/inbound/catererauth"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// The caterer portal's catalog proxy reads the second factor's state,
// starts it and forgets a remembered device (#2352): the routes answer in
// the envelope, under the /caterer mount the root gives them.
func TestCatererSecondFactorRoutesAnswerInTheEnvelope(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupIsolatedTestDB(t)
	// The code mail goes to a capturing mailer; the start answers once it is sent.
	module, err := api.NewAuthTestModule(testpkg.NewDatabase(t, db), testpkg.TenantRuntime(t, db),
		api.WithAuthTestMailer(testpkg.NewCapturingMailer()), api.WithAuthTestMFABackoff(time.Millisecond))
	require.NoError(t, err)
	caterers := module.Auth.Caterers()
	require.NotNil(t, caterers)
	account := testpkg.CreateTestAccount(t, db, "caterer-second-factor-routes")
	var catererID int64
	require.NoError(t, db.NewRaw("INSERT INTO auth.caterers (name) VALUES ('Second factor kitchen') RETURNING id").Scan(context.Background(), &catererID))
	_, err = db.ExecContext(context.Background(), "INSERT INTO auth.caterer_accounts (account_id,caterer_id) VALUES (?,?)", account.ID, catererID)
	require.NoError(t, err)
	t.Cleanup(func() {
		ctx := context.Background()
		_, err := db.ExecContext(ctx, "DELETE FROM auth.mfa_trusted_devices WHERE account_id = ?", account.ID)
		assert.NoError(t, err)
		_, err = db.ExecContext(ctx, `DELETE FROM platform.email_outbox
			WHERE tenant_id IS NULL AND lower(recipient->>'address') = lower(?)`, account.Email)
		assert.NoError(t, err)
		_, err = db.ExecContext(ctx, "DELETE FROM auth.caterers WHERE id=?", catererID)
		assert.NoError(t, err)
	})
	routes := catererauth.NewResource(caterers, caterers)
	caterer := chi.NewRouter()
	caterer.Use(render.SetContentType(render.ContentTypeJSON))
	caterer.Group(func(r chi.Router) {
		api.CatererSessionChain(r)
		routes.MountSession(r)
		routes.MountCredentialChecks(r)
	})
	router := testutil.NewTenantRouter(db)
	router.Use(api.RequestSettingsCacheMiddleware, api.RequestIdentityCacheMiddleware)
	router.Mount("/caterer", caterer)
	claims := testutil.TenantUserTestClaims(int(account.ID), testpkg.Tenant(t))
	claims.Scope = "caterer"
	claims.TenantID = 0
	claims.Roles = []string{"caterer"}
	token := testutil.MintTestJWT(t, claims)
	call := func(method, path string) map[string]any {
		t.Helper()
		rr := testutil.ExecuteRequest(router, testutil.NewAuthenticatedRequest(t, method, path, nil, testutil.WithJWTBearer(token)))
		require.Equal(t, http.StatusOK, rr.Code, rr.Body.String())
		var envelope struct {
			Status string         `json:"status"`
			Data   map[string]any `json:"data"`
		}
		require.NoError(t, json.Unmarshal(rr.Body.Bytes(), &envelope))
		assert.Equal(t, "success", envelope.Status)
		return envelope.Data
	}

	status := call(http.MethodGet, "/caterer/account/mfa")
	assert.Equal(t, false, status["enabled"])

	challenge := call(http.MethodPost, "/caterer/account/mfa/start")
	assert.NotEmpty(t, challenge["challenge_token"])

	var deviceID int64
	require.NoError(t, db.NewRaw(`INSERT INTO auth.mfa_trusted_devices (account_id, token_hash, user_agent, ip_address, created_at, expires_at)
		VALUES (?, ?, 'Caterer browser', '127.0.0.1', ?, ?) RETURNING id`, account.ID, fmt.Sprintf("example-device-%d-route", account.ID),
		time.Date(2026, 1, 2, 12, 0, 0, 0, time.UTC), time.Date(2099, 1, 2, 12, 0, 0, 0, time.UTC)).Scan(context.Background(), &deviceID))
	rr := testutil.ExecuteRequest(router, testutil.NewAuthenticatedRequest(t, http.MethodDelete, fmt.Sprintf("/caterer/auth/mfa/trusted-devices/%d", deviceID), nil, testutil.WithJWTBearer(token)))
	require.Equal(t, http.StatusNoContent, rr.Code, rr.Body.String())
	var revoked bool
	require.NoError(t, db.NewRaw("SELECT revoked_at IS NOT NULL FROM auth.mfa_trusted_devices WHERE id = ?", deviceID).Scan(context.Background(), &revoked))
	assert.True(t, revoked)
}
