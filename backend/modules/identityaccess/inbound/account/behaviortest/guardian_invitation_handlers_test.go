package account_test

import (
	"encoding/json"
	"net/http"
	"net/url"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/modules/identityaccess"
	testpkg "github.com/moto-ogs/project-phoenix/test"

	rootAPI "github.com/moto-ogs/project-phoenix/api"
	transactionFailures "github.com/moto-ogs/project-phoenix/modules/transactionruntime"

	"github.com/go-chi/chi/v5"

	"github.com/moto-ogs/project-phoenix/api/testutil"
	identityaccessCompose "github.com/moto-ogs/project-phoenix/modules/identityaccess/compose"
	authAPI "github.com/moto-ogs/project-phoenix/modules/identityaccess/inbound/account"
)

// setupGuardianInvitationRouter mounts the real auth Router() with the
// guardian invitation service wired, so these tests exercise the live
// public routes GET/POST /auth/guardian-invitations/{token}[/accept].
func setupGuardianInvitationRouter(t *testing.T) chi.Router {
	t.Helper()

	db, authRoute := setupAuthDependenciesRoute(t)
	resource := authAPI.NewResource(authRoute.AuthService, authRoute.Invitations, nil, authRoute.Sessions, identityaccessCompose.TenantUnitOfWork{}, transactionFailures.IsConstraintViolation, authRoute.SettingsService)

	router := testutil.NewTenantRouter(db)
	router.Mount("/auth", resource.Router(rootAPI.TenantSessionChain))
	return router
}

func TestValidateGuardianInvitation_NotFound(t *testing.T) {
	t.Parallel()
	router := setupGuardianInvitationRouter(t)

	req := testutil.NewJSONRequest(t, "GET", "/auth/guardian-invitations/invalid-token-12345", nil)

	rr := testutil.ExecuteRequest(router, req)

	testutil.AssertNotFound(t, rr)
}

// A valid link answers the invitation through the public route, the answer
// the parents' accept page reads through the contract (#7808).
func TestValidateGuardianInvitation_AnswersTheInvitation(t *testing.T) {
	t.Parallel()
	db, authRoute := setupAuthDependenciesRoute(t)
	resource := authAPI.NewResource(authRoute.AuthService, authRoute.Invitations, nil, authRoute.Sessions, identityaccessCompose.TenantUnitOfWork{}, transactionFailures.IsConstraintViolation, authRoute.SettingsService)
	router := testutil.NewTenantRouter(db)
	router.Mount("/auth", resource.Router(rootAPI.TenantSessionChain))

	profile := testpkg.CreateTestGuardianProfile(t, db, "validate-route")
	invitation, err := authRoute.GuardianInvitations.CreateGuardianInvitation(testpkg.Ctx(t), identityaccess.GuardianInvitationRequest{
		GuardianProfileID: profile.ID, CreatedBy: testpkg.CreateTestAccount(t, db, "validate-route-inviter").ID,
	})
	require.NoError(t, err)

	rr := testutil.ExecuteRequest(router, testutil.NewJSONRequest(t, http.MethodGet, "/auth/guardian-invitations/"+url.PathEscape(invitation.Token), nil))

	require.Equal(t, http.StatusOK, rr.Code, rr.Body.String())
	var body struct {
		Data authAPI.GuardianInvitationValidateResponse `json:"data"`
	}
	require.NoError(t, json.Unmarshal(rr.Body.Bytes(), &body))
	assert.Equal(t, *profile.Email, body.Data.Email)
	assert.False(t, body.Data.ExpiresAt.IsZero())
}

func TestAcceptGuardianInvitation_NotFound(t *testing.T) {
	t.Parallel()
	router := setupGuardianInvitationRouter(t)

	body := map[string]any{
		"password":         "Test1234%",
		"confirm_password": "Test1234%",
	}

	req := testutil.NewJSONRequest(t, "POST", "/auth/guardian-invitations/invalid-token-12345/accept", body)

	rr := testutil.ExecuteRequest(router, req)

	testutil.AssertNotFound(t, rr)
}

func TestAcceptGuardianInvitation_BadRequest_MissingPassword(t *testing.T) {
	t.Parallel()
	router := setupGuardianInvitationRouter(t)

	body := map[string]any{
		"confirm_password": "Test1234%",
	}

	req := testutil.NewJSONRequest(t, "POST", "/auth/guardian-invitations/some-token/accept", body)

	rr := testutil.ExecuteRequest(router, req)

	testutil.AssertBadRequest(t, rr)
}

func TestAcceptGuardianInvitation_BadRequest_PasswordMismatch(t *testing.T) {
	t.Parallel()
	router := setupGuardianInvitationRouter(t)

	body := map[string]any{
		"password":         "Test1234%",
		"confirm_password": "DifferentPassword%",
	}

	req := testutil.NewJSONRequest(t, "POST", "/auth/guardian-invitations/some-token/accept", body)

	rr := testutil.ExecuteRequest(router, req)

	testutil.AssertBadRequest(t, rr)
}
