//go:build testhooks

package catererauth_test

import (
	"bytes"
	"context"
	"net"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/api/testutil/routetest"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess/inbound/catererauth"
)

// secondFactorStub answers the caterer's passkey and factor routes; every
// other method of the capability is unused here.
type secondFactorStub struct {
	identityaccess.CatererSecondFactor
	accountID       int64
	code            string
	sessionID       string
	revokedPasskey  int64
	disablePassword string
}

func (s *secondFactorStub) StartCatererPasskeyEnrollment(_ context.Context, accountID int64, _ net.IP) (identityaccess.PasskeyEnrollmentChallenge, error) {
	s.accountID = accountID
	return identityaccess.PasskeyEnrollmentChallenge{ChallengeToken: "caterer-challenge", MaskedEmail: "k***@example.test"}, nil
}

func (s *secondFactorStub) BeginCatererPasskeyRegistration(_ context.Context, request identityaccess.CatererPasskeyRegistrationStart) (identityaccess.PasskeyCeremonyOptions, error) {
	s.code = request.Code
	return identityaccess.PasskeyCeremonyOptions{SessionID: "caterer-registration", Options: map[string]string{"challenge": "register"}}, nil
}

func (s *secondFactorStub) FinishCatererPasskeyRegistration(_ context.Context, request identityaccess.AccountPasskeyRegistrationFinish) (identityaccess.PasskeyCredentialSummary, error) {
	s.sessionID = request.SessionID
	return identityaccess.PasskeyCredentialSummary{ID: 12, Name: request.Name, CreatedAt: time.Unix(1, 0).UTC()}, nil
}

func (s *secondFactorStub) RevokeCatererPasskey(_ context.Context, _, passkeyID int64) error {
	s.revokedPasskey = passkeyID
	return nil
}

func (s *secondFactorStub) DisableCatererMFA(_ context.Context, _ int64, currentPassword, _, _ string) error {
	s.disablePassword = currentPassword
	return nil
}

type signInStub struct{ identityaccess.CatererSignIn }

// The caterer's passkey registration, its revoke and the switch-off of the
// second factor answer under the /caterer mount, so each answer is held to
// its registered route (#7808). The real ceremonies are covered by the
// Identity & Access behaviour tests; a WebAuthn attestation cannot be built
// here.
func TestCatererFactorRoutesAnswerUnderTheirMount(t *testing.T) {
	t.Parallel()
	svc := &secondFactorStub{}
	routes := catererauth.NewResource(signInStub{}, svc)
	const accountID = 41
	caterer := chi.NewRouter()
	caterer.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			claims := routetest.Claims{ID: accountID, Scope: "caterer"}
			next.ServeHTTP(w, r.WithContext(routetest.WithAuthenticatedContext(r.Context(), claims, nil)))
		})
	})
	routes.MountSession(caterer)
	routes.MountCredentialChecks(caterer)
	router := chi.NewRouter()
	router.Mount("/caterer", caterer)
	call := func(method, path, body string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, path, bytes.NewBufferString(body))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Origin", "https://caterer.localhost")
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		return rec
	}

	rec := call(http.MethodPost, "/caterer/auth/passkeys/enrollment/challenge", `{}`)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	assert.EqualValues(t, accountID, svc.accountID)
	assert.JSONEq(t, `{"status":"success","message":"Passkey enrollment code sent","data":{"challenge_token":"caterer-challenge","masked_email":"k***@example.test"}}`, rec.Body.String())

	rec = call(http.MethodPost, "/caterer/auth/passkeys/register/options", `{"code":"123456","name":"Küche"}`)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	assert.Equal(t, "123456", svc.code)

	rec = call(http.MethodPost, "/caterer/auth/passkeys/register/verify", `{"session_id":"caterer-registration","name":"Küche","response":{"id":"credential"}}`)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	assert.Equal(t, "caterer-registration", svc.sessionID)
	assert.JSONEq(t, `{"status":"success","message":"Passkey registered","data":{"id":"12","name":"Küche","created_at":"1970-01-01T00:00:01Z"}}`, rec.Body.String())

	rec = call(http.MethodDelete, "/caterer/auth/passkeys/12", "")
	require.Equal(t, http.StatusNoContent, rec.Code, rec.Body.String())
	assert.EqualValues(t, 12, svc.revokedPasskey)

	rec = call(http.MethodPost, "/caterer/account/mfa/disable", `{"current_password":"secret"}`)
	require.Equal(t, http.StatusNoContent, rec.Code, rec.Body.String())
	assert.Equal(t, "secret", svc.disablePassword)
}

// sessionSignInStub mints sessions for the caterer's sign-in steps.
type sessionSignInStub struct{ identityaccess.CatererSignIn }

func (sessionSignInStub) VerifyCatererMFA(context.Context, identityaccess.CatererMFAVerification) (identityaccess.CatererSession, error) {
	return identityaccess.CatererSession{AccessToken: "access", RefreshToken: "refresh"}, nil
}

func (sessionSignInStub) ResendCatererMFA(context.Context, string, net.IP) (string, error) {
	return "renewed", nil
}

func (sessionSignInStub) BeginCatererPasskeyLogin(context.Context, string) (identityaccess.PasskeyCeremonyOptions, error) {
	return identityaccess.PasskeyCeremonyOptions{SessionID: "login", Options: map[string]string{"challenge": "login"}}, nil
}

func (sessionSignInStub) FinishCatererPasskeyLogin(context.Context, identityaccess.AccountPasskeyLoginFinish) (identityaccess.PasskeyLoginResult, error) {
	return identityaccess.PasskeyLoginResult{AccessToken: "access", RefreshToken: "refresh"}, nil
}

type confirmStub struct{ secondFactorStub }

func (*confirmStub) ConfirmCatererMFA(context.Context, identityaccess.CatererMFAConfirmation) (identityaccess.CatererSession, error) {
	return identityaccess.CatererSession{AccessToken: "access", RefreshToken: "refresh"}, nil
}

// The caterer's session steps answer their tokens without the envelope to
// the portal's route file (#7808); each answer is held to its registered
// route under the /caterer mount.
func TestCatererSessionStepsAnswerTheirTokensUnderTheirMount(t *testing.T) {
	t.Parallel()
	routes := catererauth.NewResource(sessionSignInStub{}, &confirmStub{})
	caterer := chi.NewRouter()
	routes.MountSignIn(caterer)
	caterer.Group(func(r chi.Router) {
		r.Use(func(next http.Handler) http.Handler {
			return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				claims := routetest.Claims{ID: 41, Scope: "caterer"}
				next.ServeHTTP(w, r.WithContext(routetest.WithAuthenticatedContext(r.Context(), claims, nil)))
			})
		})
		routes.MountCredentialChecks(r)
	})
	router := chi.NewRouter()
	router.Mount("/caterer", caterer)
	tokens := `{"access_token":"access","refresh_token":"refresh"}`
	for path, want := range map[string]string{
		"/caterer/auth/mfa/verify":             tokens,
		"/caterer/account/mfa/confirm":         tokens,
		"/caterer/auth/mfa/resend":             `{"challenge_token":"renewed"}`,
		"/caterer/auth/passkeys/login/options": `{"session_id":"login","options":{"challenge":"login"}}`,
		"/caterer/auth/passkeys/login/verify":  `{"status":"authenticated","access_token":"access","refresh_token":"refresh"}`,
	} {
		req := httptest.NewRequest(http.MethodPost, path,
			bytes.NewBufferString(`{"challenge_token":"challenge","code":"123456","session_id":"login","response":{"id":"assertion"}}`))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Origin", "https://caterer.localhost")
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		require.Equal(t, http.StatusOK, rec.Code, "%s: %s", path, rec.Body.String())
		assert.JSONEq(t, want, rec.Body.String(), path)
	}
}
