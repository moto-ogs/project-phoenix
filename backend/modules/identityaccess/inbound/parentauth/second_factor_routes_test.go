//go:build testhooks

package parentauth_test

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
	"github.com/moto-ogs/project-phoenix/modules/identityaccess"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess/inbound/parentauth"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess/sessiontoken"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// The parents portal's catalog proxy reads the second factor's state,
// starts it and forgets a remembered device (#2352): the routes answer in
// the envelope, under the /parent mount the root gives them.
func TestParentSecondFactorRoutesAnswerInTheEnvelope(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupIsolatedTestDB(t)
	// The code mail goes to a capturing mailer; the start answers once it is sent.
	module, err := api.NewAuthTestModule(testpkg.NewDatabase(t, db), testpkg.TenantRuntime(t, db),
		api.WithAuthTestMailer(testpkg.NewCapturingMailer()), api.WithAuthTestMFABackoff(time.Millisecond))
	require.NoError(t, err)
	access, ok := module.Auth.(identityaccess.ParentPortalAccess)
	require.True(t, ok)
	chain := testpkg.CreateTestParentGuardianChain(t, db)
	var email string
	require.NoError(t, db.NewRaw("SELECT email FROM auth.accounts WHERE id = ?", chain.AccountID).Scan(context.Background(), &email))
	t.Cleanup(func() {
		ctx := context.Background()
		_, err := db.ExecContext(ctx, "DELETE FROM auth.mfa_trusted_devices WHERE account_id = ?", chain.AccountID)
		assert.NoError(t, err)
		_, err = db.ExecContext(ctx, `DELETE FROM platform.email_outbox
			WHERE tenant_id IS NULL AND lower(recipient->>'address') = lower(?)`, email)
		assert.NoError(t, err)
	})
	routes := parentauth.NewResource(access.Parents())
	parent := chi.NewRouter()
	parent.Use(render.SetContentType(render.ContentTypeJSON))
	parent.Group(func(r chi.Router) {
		api.ParentSessionChain(r)
		routes.MountSession(r)
		routes.MountCredentialChecks(r)
	})
	router := testutil.NewTenantRouter(db)
	router.Use(api.RequestSettingsCacheMiddleware, api.RequestIdentityCacheMiddleware)
	router.Mount("/parent", parent)
	token := testutil.MintTestJWT(t, sessiontoken.AppClaims{ID: int(chain.AccountID), Sub: fmt.Sprint(chain.AccountID), Roles: []string{"parent"}, Scope: "parent"})
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

	status := call(http.MethodGet, "/parent/me/mfa")
	assert.Equal(t, false, status["enabled"])
	assert.Equal(t, true, status["available"], "a parent at a school may switch the factor on")

	challenge := call(http.MethodPost, "/parent/me/mfa/start")
	assert.NotEmpty(t, challenge["challenge_token"])
	assert.NotEmpty(t, challenge["masked_email"])

	var deviceID int64
	require.NoError(t, db.NewRaw(`INSERT INTO auth.mfa_trusted_devices (account_id, parent_portal, token_hash, user_agent, ip_address, created_at, expires_at)
		VALUES (?, TRUE, ?, 'Parent browser', '127.0.0.1', ?, ?) RETURNING id`, chain.AccountID, fmt.Sprintf("example-device-%d-route", chain.AccountID),
		time.Date(2026, 1, 2, 12, 0, 0, 0, time.UTC), time.Date(2099, 1, 2, 12, 0, 0, 0, time.UTC)).Scan(context.Background(), &deviceID))
	rr := testutil.ExecuteRequest(router, testutil.NewAuthenticatedRequest(t, http.MethodDelete, fmt.Sprintf("/parent/me/mfa/trusted-devices/%d", deviceID), nil, testutil.WithJWTBearer(token)))
	require.Equal(t, http.StatusNoContent, rr.Code, rr.Body.String())
	var revoked bool
	require.NoError(t, db.NewRaw("SELECT revoked_at IS NOT NULL FROM auth.mfa_trusted_devices WHERE id = ?", deviceID).Scan(context.Background(), &revoked))
	assert.True(t, revoked)
}
