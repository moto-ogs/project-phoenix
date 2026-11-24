package api

import (
	"bytes"
	"context"
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/api/testutil"
	"github.com/moto-ogs/project-phoenix/api/testutil/routetest"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess"
	identityoperator "github.com/moto-ogs/project-phoenix/modules/identityaccess/inbound/operator"
)

type operatorPasskeyServiceStub struct {
	beginLoginOrigin      string
	finishLoginReq        identityaccess.OperatorPasskeyLoginFinish
	enrollmentOperatorID  int64
	beginRegistrationReq  identityaccess.OperatorPasskeyRegistrationStart
	finishRegistrationReq identityaccess.OperatorPasskeyRegistrationFinish
	listOperatorID        int64
	revokeOperatorID      int64
	revokeCredentialID    int64
	beginLoginErr         error
	finishLoginErr        error
	startEnrollmentErr    error
	beginRegistrationErr  error
	finishRegistrationErr error
	listErr               error
	revokeErr             error
}

func (s *operatorPasskeyServiceStub) StartOperatorPasskeyEnrollment(_ context.Context, operatorID int64, _ net.IP) (identityaccess.PasskeyEnrollmentChallenge, error) {
	s.enrollmentOperatorID = operatorID
	if s.startEnrollmentErr != nil {
		return identityaccess.PasskeyEnrollmentChallenge{}, s.startEnrollmentErr
	}
	return identityaccess.PasskeyEnrollmentChallenge{ChallengeToken: "operator-challenge-token", MaskedEmail: "o***@example.test"}, nil
}

func (s *operatorPasskeyServiceStub) BeginOperatorPasskeyRegistration(_ context.Context, req identityaccess.OperatorPasskeyRegistrationStart) (identityaccess.PasskeyCeremonyOptions, error) {
	s.beginRegistrationReq = req
	if s.beginRegistrationErr != nil {
		return identityaccess.PasskeyCeremonyOptions{}, s.beginRegistrationErr
	}
	return identityaccess.PasskeyCeremonyOptions{SessionID: "operator-registration", Options: map[string]string{"challenge": "register"}}, nil
}

func (s *operatorPasskeyServiceStub) FinishOperatorPasskeyRegistration(_ context.Context, req identityaccess.OperatorPasskeyRegistrationFinish) (identityaccess.PasskeyCredentialSummary, error) {
	s.finishRegistrationReq = req
	if s.finishRegistrationErr != nil {
		return identityaccess.PasskeyCredentialSummary{}, s.finishRegistrationErr
	}
	return identityaccess.PasskeyCredentialSummary{ID: 9, Name: "Admin laptop", CreatedAt: time.Unix(1, 0).UTC()}, nil
}

func (s *operatorPasskeyServiceStub) BeginOperatorPasskeyLogin(_ context.Context, expectedOrigin string) (identityaccess.PasskeyCeremonyOptions, error) {
	s.beginLoginOrigin = expectedOrigin
	if s.beginLoginErr != nil {
		return identityaccess.PasskeyCeremonyOptions{}, s.beginLoginErr
	}
	return identityaccess.PasskeyCeremonyOptions{SessionID: "operator-login", Options: map[string]string{"challenge": "login"}}, nil
}

func (s *operatorPasskeyServiceStub) FinishOperatorPasskeyLogin(_ context.Context, req identityaccess.OperatorPasskeyLoginFinish) (identityaccess.PasskeyLoginResult, error) {
	s.finishLoginReq = req
	if s.finishLoginErr != nil {
		return identityaccess.PasskeyLoginResult{}, s.finishLoginErr
	}
	return identityaccess.PasskeyLoginResult{AccessToken: "operator-access", RefreshToken: "operator-refresh"}, nil
}

func (s *operatorPasskeyServiceStub) ListOperatorPasskeyCredentials(_ context.Context, operatorID int64) ([]identityaccess.PasskeyCredentialSummary, error) {
	s.listOperatorID = operatorID
	if s.listErr != nil {
		return nil, s.listErr
	}
	return []identityaccess.PasskeyCredentialSummary{{ID: 10, Name: "Phone", CreatedAt: time.Unix(2, 0).UTC()}}, nil
}

func (s *operatorPasskeyServiceStub) RevokeOperatorPasskeyCredential(_ context.Context, operatorID, credentialID int64) error {
	s.revokeOperatorID = operatorID
	s.revokeCredentialID = credentialID
	return s.revokeErr
}

func TestOperatorPasskeyLoginHandlers(t *testing.T) {
	t.Parallel()

	svc := &operatorPasskeyServiceStub{}
	rs := identityoperator.NewPasskeyResource(svc)

	w := httptest.NewRecorder()
	req := operatorPasskeyJSONRequest("/auth/passkeys/login/options", `{}`)
	req.Header.Set("X-Moto-Frontend-Origin", "https://operator.localhost")
	testutil.ServeAtRoute(w, req, "/operator/auth/passkeys/login/options", rs.PasskeyLoginOptions)

	require.Equal(t, http.StatusOK, w.Code)
	assert.Equal(t, "https://operator.localhost", svc.beginLoginOrigin)
	assert.JSONEq(t, `{"session_id":"operator-login","options":{"challenge":"login"}}`, w.Body.String())

	w = httptest.NewRecorder()
	req = operatorPasskeyJSONRequest("/auth/passkeys/login/verify", `{"session_id":"operator-login","response":{"id":"assertion"}}`)
	req.Header.Set("User-Agent", "operator-agent")
	req.RemoteAddr = "203.0.113.11:1234"
	testutil.ServeAtRoute(w, req, "/operator/auth/passkeys/login/verify", rs.PasskeyLoginVerify)

	require.Equal(t, http.StatusOK, w.Code)
	assert.Equal(t, "operator-login", svc.finishLoginReq.SessionID)
	assert.Equal(t, "operator-agent", svc.finishLoginReq.UserAgent)
	assert.JSONEq(t, `{"status":"authenticated","access_token":"operator-access","refresh_token":"operator-refresh"}`, w.Body.String())
}

func TestOperatorPasskeyLoginRoutesArePublic(t *testing.T) {
	t.Parallel()

	svc := &operatorPasskeyServiceStub{}
	router := chi.NewRouter()
	router.Mount("/operator", testOperatorRouter(operatorIdentity{
		passkeys: svc,
		sessions: identityoperator.NewSessions(routetest.TestTokenAuth(t), nil),
	}, nil))

	req := operatorPasskeyJSONRequest("/operator/auth/passkeys/login/options", `{}`)
	req.Header.Set("X-Moto-Frontend-Origin", "https://operator.localhost")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	require.Equal(t, http.StatusOK, w.Code)
	assert.Equal(t, "https://operator.localhost", svc.beginLoginOrigin)
	assert.JSONEq(t, `{"session_id":"operator-login","options":{"challenge":"login"}}`, w.Body.String())
}

// TestOperatorPasskeyListRouteServesOnlyContractForm: the list answers the
// contract path GET /operator/auth/passkeys, which the catalog
// proxy calls, for a signed-in operator. The trailing-slash form is no route:
// it 404s before any middleware, so no second spelling of the list exists (#2352).
func TestOperatorPasskeyListRouteServesOnlyContractForm(t *testing.T) {
	t.Parallel()

	authService := &mockOperatorAuthService{
		getOperatorFn: func(_ context.Context, id int64) (*identityaccess.Operator, error) {
			op := &identityaccess.Operator{Active: true}
			op.ID = id
			return op, nil
		},
	}
	svc := &operatorPasskeyServiceStub{}
	router := chi.NewRouter()
	router.Mount("/operator", testOperatorRouter(operatorIdentity{
		access:   authService,
		passkeys: svc,
		sessions: operatorTestSessions(t, authService),
	}, nil))
	token := operatorRouteAccessToken(t, 21)

	get := func(path, bearer string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodGet, path, nil)
		if bearer != "" {
			req.Header.Set("Authorization", "Bearer "+bearer)
		}
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)
		return w
	}

	w := get("/operator/auth/passkeys", token)
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	assert.EqualValues(t, 21, svc.listOperatorID)
	assert.Contains(t, w.Body.String(), `"name":"Phone"`)

	assert.Equal(t, http.StatusUnauthorized, get("/operator/auth/passkeys", "").Code,
		"the list is protected")
	assert.Equal(t, http.StatusNotFound, get("/operator/auth/passkeys/", token).Code,
		"the trailing-slash form is not registered")
}

// TestOperatorPasskeyAuthenticatedHandlers drives the signed-in passkey
// routes through the operator router under its /operator mount, so each
// answer is held to its registered route (#7808).
func TestOperatorPasskeyAuthenticatedHandlers(t *testing.T) {
	t.Parallel()

	authService := &mockOperatorAuthService{
		getOperatorFn: func(_ context.Context, id int64) (*identityaccess.Operator, error) {
			op := &identityaccess.Operator{Active: true}
			op.ID = id
			return op, nil
		},
	}
	svc := &operatorPasskeyServiceStub{}
	router := chi.NewRouter()
	router.Mount("/operator", testOperatorRouter(operatorIdentity{
		access:   authService,
		passkeys: svc,
		sessions: operatorTestSessions(t, authService),
	}, nil))
	const operatorID = 21
	token := operatorRouteAccessToken(t, operatorID)
	serve := func(req *http.Request) *httptest.ResponseRecorder {
		req.Header.Set("Authorization", "Bearer "+token)
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)
		return w
	}

	w := serve(operatorPasskeyJSONRequest("/operator/auth/passkeys/enrollment/challenge", `{}`))
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	assert.EqualValues(t, operatorID, svc.enrollmentOperatorID)
	assert.JSONEq(t, `{"status":"success","message":"Passkey enrollment code sent","data":{"challenge_token":"operator-challenge-token","masked_email":"o***@example.test"}}`, w.Body.String())

	req := operatorPasskeyJSONRequest("/operator/auth/passkeys/register/options", `{"code":"654321","name":" Admin laptop "}`)
	req.Header.Set("Origin", "https://operator.localhost")
	w = serve(req)
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	assert.EqualValues(t, operatorID, svc.beginRegistrationReq.OperatorID)
	assert.Equal(t, "Admin laptop", svc.beginRegistrationReq.Name)

	w = serve(operatorPasskeyJSONRequest("/operator/auth/passkeys/register/verify", `{"session_id":"operator-registration","name":"Phone","response":{"id":"credential"}}`))
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	assert.Equal(t, "operator-registration", svc.finishRegistrationReq.SessionID)
	assert.JSONEq(t, `{"status":"success","message":"Passkey registered","data":{"id":"9","name":"Admin laptop","created_at":"1970-01-01T00:00:01Z"}}`, w.Body.String())

	w = serve(httptest.NewRequest(http.MethodGet, "/operator/auth/passkeys", nil))
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	assert.EqualValues(t, operatorID, svc.listOperatorID)
	assert.JSONEq(t, `{"status":"success","message":"Passkeys retrieved","data":[{"id":"10","name":"Phone","created_at":"1970-01-01T00:00:02Z"}]}`, w.Body.String())

	passkeyID := svc.enrollmentOperatorID + 1
	w = serve(httptest.NewRequest(http.MethodDelete, "/operator/auth/passkeys/"+strconv.FormatInt(passkeyID, 10), nil))
	require.Equal(t, http.StatusNoContent, w.Code, w.Body.String())
	assert.EqualValues(t, operatorID, svc.revokeOperatorID)
	assert.Equal(t, passkeyID, svc.revokeCredentialID)
}

func TestOperatorPasskeyHandlerErrors(t *testing.T) {
	t.Parallel()

	rs := identityoperator.NewPasskeyResource(nil)
	w := httptest.NewRecorder()
	testutil.ServeAtRoute(w, operatorPasskeyJSONRequest("/auth/passkeys/login/options", `{}`), "/operator/auth/passkeys/login/options", rs.PasskeyLoginOptions)
	assert.Equal(t, http.StatusServiceUnavailable, w.Code)

	rs = identityoperator.NewPasskeyResource(&operatorPasskeyServiceStub{})
	w = httptest.NewRecorder()
	testutil.ServeAtRoute(w, operatorPasskeyJSONRequest("/auth/passkeys/login/options", `{}`), "/operator/auth/passkeys/login/options", rs.PasskeyLoginOptions)
	assert.Equal(t, http.StatusBadRequest, w.Code)
}

// TestOperatorPasskeyStoreFailuresAreNotClientErrors pins the wire outcome
// of the passkey completions (#2724): a refused ceremony or a missing
// passkey stays a client error, a store failure behind them is a server
// error.
func TestOperatorPasskeyStoreFailuresAreNotClientErrors(t *testing.T) {
	t.Parallel()

	storeDown := errors.New("database error during consume operator passkey session: connection reset")
	claims := routetest.Claims{ID: 41}
	loginVerify := func(rs *identityoperator.PasskeyResource, w http.ResponseWriter) {
		testutil.ServeAtRoute(w, operatorPasskeyJSONRequest("/auth/passkeys/login/verify", `{"session_id":"s","response":{"id":"a"}}`), "/operator/auth/passkeys/login/verify", rs.PasskeyLoginVerify)
	}
	registerVerify := func(rs *identityoperator.PasskeyResource, w http.ResponseWriter) {
		req := operatorPasskeyJSONRequest("/auth/passkeys/register/verify", `{"session_id":"s","response":{"id":"a"}}`)
		rs.PasskeyRegisterVerify(w, withOperatorPasskeyClaims(req, claims))
	}
	revoke := func(rs *identityoperator.PasskeyResource, w http.ResponseWriter) {
		req := withOperatorPasskeyClaims(httptest.NewRequest(http.MethodDelete, "/auth/passkeys/7", nil), claims)
		rs.PasskeyRevoke(w, withOperatorPasskeyRouteParam(req, "passkeyId", "7"))
	}
	tests := []struct {
		name     string
		svc      *operatorPasskeyServiceStub
		call     func(*identityoperator.PasskeyResource, http.ResponseWriter)
		wantCode int
	}{
		{"login with a spent ceremony", &operatorPasskeyServiceStub{finishLoginErr: identityaccess.ErrPasskeySessionInvalid}, loginVerify, http.StatusUnauthorized},
		{"login with wrong credentials", &operatorPasskeyServiceStub{finishLoginErr: identityaccess.ErrOperatorInvalidCredentials}, loginVerify, http.StatusUnauthorized},
		{"registration for an inactive operator", &operatorPasskeyServiceStub{finishRegistrationErr: identityaccess.ErrOperatorInactive}, registerVerify, http.StatusForbidden},
		{"login with a store failure", &operatorPasskeyServiceStub{finishLoginErr: storeDown}, loginVerify, http.StatusInternalServerError},
		{"registration with a spent ceremony", &operatorPasskeyServiceStub{finishRegistrationErr: identityaccess.ErrPasskeySessionInvalid}, registerVerify, http.StatusUnauthorized},
		{"registration with a store failure", &operatorPasskeyServiceStub{finishRegistrationErr: storeDown}, registerVerify, http.StatusInternalServerError},
		{"revoke of a missing passkey", &operatorPasskeyServiceStub{revokeErr: identityaccess.ErrPasskeyNotFound}, revoke, http.StatusNotFound},
		{"revoke with a store failure", &operatorPasskeyServiceStub{revokeErr: storeDown}, revoke, http.StatusInternalServerError},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			w := httptest.NewRecorder()
			tt.call(identityoperator.NewPasskeyResource(tt.svc), w)
			assert.Equal(t, tt.wantCode, w.Code)
			assert.NotContains(t, w.Body.String(), "connection reset", "store details stay out of the response")
		})
	}
}

func operatorPasskeyJSONRequest(path, body string) *http.Request {
	req := httptest.NewRequest(http.MethodPost, path, bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	return req
}

func withOperatorPasskeyClaims(req *http.Request, claims routetest.Claims) *http.Request {
	return req.WithContext(routetest.WithAuthenticatedContext(req.Context(), claims, nil))
}

func withOperatorPasskeyRouteParam(req *http.Request, key, value string) *http.Request {
	rctx := chi.NewRouteContext()
	rctx.URLParams.Add(key, value)
	return req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, rctx))
}
