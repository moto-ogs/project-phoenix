package api

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"

	"github.com/moto-ogs/project-phoenix/modules/identityaccess"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess/inbound/portalauth"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// The parent portal, moto schule and the caterer portal mount the same reset
// routes with their own scope (serve_mounts_portals.go, serve_mounts_school.go,
// caterer_portal.go). Each answers under its catalog path, so the answer is
// held to its registered route (#7808).
func TestPortalPasswordResetRoutesAnswerUnderTheirMount(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	module, err := NewAuthTestModule(testpkg.NewDatabase(t, db), testpkg.TenantRuntime(t, db),
		WithAuthTestMailer(testpkg.NewCapturingMailer()))
	require.NoError(t, err)

	for portal, scope := range map[string]identityaccess.PasswordResetScope{
		"parent":  identityaccess.PasswordResetScopeParent,
		"school":  identityaccess.PasswordResetScopeSchool,
		"caterer": identityaccess.PasswordResetScopeCaterer,
	} {
		t.Run(portal, func(t *testing.T) {
			t.Parallel()
			resets := portalauth.PasswordResetRoutes(module.Auth, scope)
			router := chi.NewRouter()
			router.Post("/"+portal+"/auth/password-reset", resets.ServeInitiate)
			router.Post("/"+portal+"/auth/password-reset/confirm", resets.ServeConfirm)
			post := func(path string, body any) *httptest.ResponseRecorder {
				payload, err := json.Marshal(body)
				require.NoError(t, err)
				req := httptest.NewRequest(http.MethodPost, path, bytes.NewReader(payload))
				req.Header.Set("Content-Type", "application/json")
				rec := httptest.NewRecorder()
				router.ServeHTTP(rec, req)
				return rec
			}

			// An unknown address gets the same answer as a known one.
			unknown := fmt.Sprintf("nobody-%s-%d@test.local", portal, testpkg.UniqueTestTenantID(t))
			t.Cleanup(func() {
				_, err := db.ExecContext(context.Background(), "DELETE FROM auth.password_reset_rate_limits WHERE email = ?", unknown)
				assert.NoError(t, err)
			})
			rec := post("/"+portal+"/auth/password-reset", map[string]string{"email": unknown})
			require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())

			// The link is the credential; ResetPassword reads no scope, so a
			// caterer account's link proves the confirm route of each portal.
			link := catererResetLink(t, module.Auth, db, portal)
			password := testpkg.NewTestPassword()
			rec = post("/"+portal+"/auth/password-reset/confirm", map[string]string{
				"token": link.Token, "new_password": password, "confirm_password": password,
			})
			require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
			rec = post("/"+portal+"/auth/password-reset/confirm", map[string]string{
				"token": link.Token, "new_password": password, "confirm_password": password,
			})
			assert.Equal(t, http.StatusGone, rec.Code, "a spent link is gone")
		})
	}
}

// catererResetLink issues a reset link for a new caterer account.
func catererResetLink(t *testing.T, resets identityaccess.PasswordResets, db *bun.DB, label string) *identityaccess.PasswordResetLink {
	t.Helper()
	ctx := context.Background()
	account := testpkg.CreateTestAccount(t, db, "reset-route-"+label)
	var catererID int64
	require.NoError(t, db.NewRaw("INSERT INTO auth.caterers (name) VALUES (?) RETURNING id", "Reset kitchen "+label).Scan(ctx, &catererID))
	_, err := db.ExecContext(ctx, "INSERT INTO auth.caterer_accounts (account_id, caterer_id) VALUES (?, ?)", account.ID, catererID)
	require.NoError(t, err)
	t.Cleanup(func() {
		ctx := context.Background()
		_, err := db.ExecContext(ctx, "DELETE FROM auth.password_reset_tokens WHERE account_id = ?", account.ID)
		assert.NoError(t, err)
		_, err = db.ExecContext(ctx, "DELETE FROM auth.password_reset_rate_limits WHERE email = ?", account.Email)
		assert.NoError(t, err)
		_, err = db.ExecContext(ctx, `DELETE FROM platform.email_outbox
			WHERE tenant_id IS NULL AND lower(recipient->>'address') = lower(?)`, account.Email)
		assert.NoError(t, err)
		_, err = db.ExecContext(ctx, "DELETE FROM auth.caterers WHERE id = ?", catererID)
		assert.NoError(t, err)
	})
	link, err := resets.InitiatePasswordReset(ctx, account.Email, identityaccess.PasswordResetScopeCaterer)
	require.NoError(t, err)
	require.NotNil(t, link, "a caterer account gets a caterer link")
	return link
}
