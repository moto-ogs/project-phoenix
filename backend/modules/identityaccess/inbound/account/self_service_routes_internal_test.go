package account

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/api/testutil"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess/inbound/portalauth"
	transactionFailures "github.com/moto-ogs/project-phoenix/modules/transactionruntime"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// The staff portal's catalog proxy reaches these routes below /auth
// (#2352). The router mounts each handler at its production pattern, so the
// answer check holds every success answer to the contract of that route.

// selfServiceRouter mounts the handlers at their patterns below /auth for a
// signed-in staff account of school 42.
func selfServiceRouter(rs *Resource) chi.Router {
	claims := testutil.Claims{ID: 11, TenantID: 42}
	router := chi.NewRouter()
	router.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			next.ServeHTTP(w, r.WithContext(testutil.WithAuthenticatedContext(r.Context(), claims, nil)))
		})
	})
	router.Route("/auth", func(r chi.Router) {
		r.Delete("/mfa/trusted-devices/{"+portalauth.TrustedDeviceIDParam+"}", rs.mfaRevokeTrustedDevice)
		r.Route("/passkeys", func(r chi.Router) {
			r.Post("/enrollment/challenge", rs.passkeyEnrollmentChallenge)
			r.Post("/register/options", rs.passkeyRegisterOptions)
			r.Post("/register/verify", rs.passkeyRegisterVerify)
			r.Delete("/{passkeyId}", rs.passkeyRevoke)
		})
		r.Get("/accounts/{accountId}/caregiver-capability", rs.getCaregiverCapability)
		r.Post("/accounts/{accountId}/caregiver-capability", rs.enableCaregiverCapability)
		r.Delete("/accounts/{accountId}/caregiver-capability", rs.disableCaregiverCapability)
	})
	return router
}

func serveSelfService(t *testing.T, router http.Handler, method, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", "https://school-a.localhost")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	return w
}

func TestStaffPasskeyAndTrustedDeviceRoutesAnswerInTheEnvelope(t *testing.T) {
	t.Parallel()

	passkeys := &passkeyServiceStub{}
	mfa := newStubMFAService()
	var revokedDevice int64
	mfa.RevokeTrustedDeviceFn = func(_ context.Context, accountID, tenantID, deviceID int64) error {
		assert.EqualValues(t, 11, accountID)
		assert.EqualValues(t, 42, tenantID)
		revokedDevice = deviceID
		return nil
	}
	rs := &Resource{
		ConstraintViolation: transactionFailures.IsConstraintViolation,
		PasskeyService:      passkeys,
		MFAService:          mfa,
		SchoolService:       passkeySchoolServiceStub{byID: &TenantSchool{ID: 42, Subdomain: "school-a", Active: true}},
	}
	router := selfServiceRouter(rs)

	data := func(w *httptest.ResponseRecorder) map[string]any {
		t.Helper()
		require.Equal(t, http.StatusOK, w.Code, w.Body.String())
		var envelope struct {
			Status string         `json:"status"`
			Data   map[string]any `json:"data"`
		}
		require.NoError(t, json.Unmarshal(w.Body.Bytes(), &envelope))
		assert.Equal(t, "success", envelope.Status)
		return envelope.Data
	}

	challenge := data(serveSelfService(t, router, http.MethodPost, "/auth/passkeys/enrollment/challenge", `{}`))
	assert.Equal(t, "challenge-token", challenge["challenge_token"])

	options := data(serveSelfService(t, router, http.MethodPost, "/auth/passkeys/register/options", `{"code":"123456","name":"Laptop"}`))
	assert.NotEmpty(t, options["session_id"])
	assert.Equal(t, "Laptop", passkeys.beginRegistrationReq.Name)

	credential := data(serveSelfService(t, router, http.MethodPost, "/auth/passkeys/register/verify", `{"session_id":"registration-session","name":"Phone","response":{"id":"credential"}}`))
	assert.Equal(t, "7", credential["id"])

	w := serveSelfService(t, router, http.MethodDelete, "/auth/passkeys/9", "")
	require.Equal(t, http.StatusNoContent, w.Code, w.Body.String())
	assert.EqualValues(t, 9, passkeys.revokeCredentialID)

	w = serveSelfService(t, router, http.MethodDelete, "/auth/mfa/trusted-devices/5", "")
	require.Equal(t, http.StatusNoContent, w.Code, w.Body.String())
	assert.EqualValues(t, 5, revokedDevice)
}

func TestCaregiverCapabilityRoutesAnswerTheState(t *testing.T) {
	t.Parallel()

	state := func(active bool) json.RawMessage {
		return json.RawMessage(`{"account_id":7,"email":"betreuer@example.test","first_name":"Bea","last_name":"Treuer",` +
			`"person_id":8,"staff_id":9,"has_admin_role":false,"has_user_role":true,"has_person":true,"has_staff":true,` +
			`"has_teacher":false,"has_caregiver_profile":` + map[bool]string{true: "true", false: "false"}[active] +
			`,"is_active_caregiver":` + map[bool]string{true: "true", false: "false"}[active] + `,"disable_blocked":false}`)
	}
	rs := &Resource{
		ConstraintViolation: transactionFailures.IsConstraintViolation,
		CaregiverCapabilityService: caregiverCapabilityServiceStub{
			getFn: func(_ context.Context, accountID int64) (json.RawMessage, error) {
				assert.EqualValues(t, 7, accountID)
				return state(false), nil
			},
			enableFn: func(_ context.Context, accountID int64, firstName, lastName, position string) (json.RawMessage, error) {
				assert.Equal(t, "Bea", firstName)
				return state(true), nil
			},
			disableFn: func(context.Context, int64) (json.RawMessage, error) { return state(false), nil },
		},
	}
	router := selfServiceRouter(rs)

	for _, call := range []struct{ method, body string }{
		{http.MethodGet, ""},
		{http.MethodPost, `{"first_name":"Bea","last_name":"Treuer"}`},
		{http.MethodDelete, ""},
	} {
		w := serveSelfService(t, router, call.method, "/auth/accounts/7/caregiver-capability", call.body)
		require.Equal(t, http.StatusOK, w.Code, w.Body.String())
		var envelope struct {
			Data struct {
				AccountID         testpkg.ID `json:"account_id"`
				IsActiveCaregiver bool       `json:"is_active_caregiver"`
			} `json:"data"`
		}
		require.NoError(t, json.Unmarshal(w.Body.Bytes(), &envelope))
		assert.EqualValues(t, 7, envelope.Data.AccountID)
		assert.Equal(t, call.method == http.MethodPost, envelope.Data.IsActiveCaregiver, call.method)
	}
}
