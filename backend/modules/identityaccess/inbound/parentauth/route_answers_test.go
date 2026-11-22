//go:build testhooks

package parentauth_test

import (
	"bytes"
	"context"
	"net"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/api/testutil/routetest"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess/inbound/parentauth"
)

// parentSecondFactorStub switches the factor off; every other method of the
// capability is unused here.
type parentSecondFactorStub struct {
	identityaccess.ParentSecondFactor
	accountID int64
	password  string
}

func (s *parentSecondFactorStub) DisableParentMFA(_ context.Context, accountID int64, currentPassword, _, _ string) error {
	s.accountID, s.password = accountID, currentPassword
	return nil
}

type parentSignInStub struct{ identityaccess.ParentSignIn }

// The parent switches the voluntary factor off under the /parent mount, so
// the answer is held to its registered route (#7808). The real switch-off
// with the current password is covered by the Identity & Access behaviour
// tests.
func TestParentMFADisableAnswersUnderItsMount(t *testing.T) {
	t.Parallel()
	svc := &parentSecondFactorStub{}
	routes := parentauth.NewResource(&identityaccess.ParentAccess{ParentSignIn: parentSignInStub{}, ParentSecondFactor: svc})
	const accountID = 52
	parent := chi.NewRouter()
	parent.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			claims := routetest.Claims{ID: accountID, Scope: "parent"}
			next.ServeHTTP(w, r.WithContext(routetest.WithAuthenticatedContext(r.Context(), claims, nil)))
		})
	})
	routes.MountCredentialChecks(parent)
	router := chi.NewRouter()
	router.Mount("/parent", parent)

	req := httptest.NewRequest(http.MethodPost, "/parent/me/mfa/disable", bytes.NewBufferString(`{"current_password":"secret"}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	require.Equal(t, http.StatusNoContent, rec.Code, rec.Body.String())
	assert.EqualValues(t, accountID, svc.accountID)
	assert.Equal(t, "secret", svc.password)
}

// parentSessionStub mints sessions for the parent's sign-in steps.
type parentSessionStub struct{ identityaccess.ParentSignIn }

func (parentSessionStub) LoginParent(context.Context, identityaccess.ParentLoginRequest) (identityaccess.ParentLoginResult, error) {
	return identityaccess.ParentLoginResult{Status: identityaccess.LoginStatusMFARequired, ChallengeToken: "challenge", MaskedEmail: "e***@test.local", TrustedDeviceDays: 30}, nil
}

func (parentSessionStub) VerifyParentMFA(context.Context, identityaccess.ParentMFAVerification) (identityaccess.ParentSession, error) {
	return identityaccess.ParentSession{AccessToken: "access", RefreshToken: "refresh"}, nil
}

func (parentSessionStub) ResendParentMFA(context.Context, string, net.IP) (string, error) {
	return "renewed", nil
}

type parentConfirmStub struct{ parentSecondFactorStub }

func (*parentConfirmStub) ConfirmParentMFA(context.Context, identityaccess.ParentMFAConfirmation) (identityaccess.ParentSession, error) {
	return identityaccess.ParentSession{AccessToken: "access", RefreshToken: "refresh"}, nil
}

// The parent's session steps answer their tokens to the portal's route file
// (#7808); each answer is held to its registered route under /parent.
func TestParentSessionStepsAnswerUnderTheirMount(t *testing.T) {
	t.Parallel()
	routes := parentauth.NewResource(&identityaccess.ParentAccess{ParentSignIn: parentSessionStub{}, ParentSecondFactor: &parentConfirmStub{}})
	parent := chi.NewRouter()
	parent.Route("/auth", func(r chi.Router) { routes.MountSignIn(r, nil) })
	parent.Group(func(r chi.Router) {
		r.Use(func(next http.Handler) http.Handler {
			return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				claims := routetest.Claims{ID: 52, Scope: "parent"}
				next.ServeHTTP(w, r.WithContext(routetest.WithAuthenticatedContext(r.Context(), claims, nil)))
			})
		})
		routes.MountCredentialChecks(r)
	})
	router := chi.NewRouter()
	router.Mount("/parent", parent)
	tokens := `{"access_token":"access","refresh_token":"refresh"}`
	for path, want := range map[string]string{
		"/parent/auth/login":      `{"status":"success","message":"Login successful","data":{"status":"mfa_required","challenge_token":"challenge","masked_email":"e***@test.local","trusted_device_enabled":true,"trusted_device_days":30}}`,
		"/parent/auth/mfa/verify": tokens,
		"/parent/auth/mfa/resend": `{"challenge_token":"renewed"}`,
		"/parent/me/mfa/confirm":  tokens,
	} {
		req := httptest.NewRequest(http.MethodPost, path,
			bytes.NewBufferString(`{"email":"eltern@test.local","password":"secret","challenge_token":"challenge","code":"123456"}`))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		require.Equal(t, http.StatusOK, rec.Code, "%s: %s", path, rec.Body.String())
		assert.JSONEq(t, want, rec.Body.String(), path)
	}
}
