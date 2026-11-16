package operator

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess/sessiontoken"
	"github.com/moto-ogs/project-phoenix/modules/organizationtenancy"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type readAuditService struct {
	organizationtenancy.Provisioning
	entries []organizationtenancy.OperatorReadAccess
	err     error
}

func (s *readAuditService) RecordOperatorRead(_ context.Context, entry organizationtenancy.OperatorReadAccess) error {
	s.entries = append(s.entries, entry)
	return s.err
}

func TestOperatorReadAuditPrecedesDisclosure(t *testing.T) {
	t.Parallel()
	for _, failed := range []bool{false, true} {
		t.Run(map[bool]string{false: "success", true: "audit unavailable"}[failed], func(t *testing.T) {
			t.Parallel()
			svc := &readAuditService{}
			if failed {
				svc.err = &organizationtenancy.OperatorAuditUnavailableError{Err: errors.New("private diagnostic")}
			}
			resource := NewProvisioningResource(ProvisioningConfig{Service: svc})
			called := false
			router := chi.NewRouter()
			router.Get("/schools/{id}/accounts/{accountId}/mfa", resource.AuditReadAccess(organizationtenancy.ReadSchoolAccountMFA, func(w http.ResponseWriter, _ *http.Request) {
				called = true
				require.Len(t, svc.entries, 1, "audit must precede reading the account")
				w.WriteHeader(http.StatusNoContent)
			}))
			req := httptest.NewRequest(http.MethodGet, "/schools/42/accounts/84/mfa?search=untrusted-filter", nil)
			req = req.WithContext(context.WithValue(req.Context(), sessiontoken.CtxClaims, sessiontoken.AppClaims{ID: 7, Scope: "platform"}))
			response := httptest.NewRecorder()
			router.ServeHTTP(response, req)
			require.Len(t, svc.entries, 1)
			entry := svc.entries[0]
			assert.EqualValues(t, 7, entry.OperatorID)
			assert.EqualValues(t, 42, entry.SchoolID)
			assert.EqualValues(t, 84, entry.AccountID)
			assert.Equal(t, !failed, called)
			if failed {
				assert.Equal(t, http.StatusServiceUnavailable, response.Code)
				assert.Contains(t, response.Body.String(), `"code":"operator.audit_unavailable"`)
				assert.NotContains(t, response.Body.String(), "private diagnostic")
			} else {
				assert.Equal(t, http.StatusNoContent, response.Code)
			}
		})
	}
}

// TestOperatorReadAuditNamesTheAffectedRouteObject pins #7212: the audit in
// front of a change of one school access or one RFID scan stores that
// object's ID, and the list routes without it stay valid.
func TestOperatorReadAuditNamesTheAffectedRouteObject(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct {
		name, method, pattern, path string
		view                        organizationtenancy.OperatorReadView
		want                        organizationtenancy.OperatorReadAccess
	}{
		{name: "school access update", method: http.MethodPut, pattern: "/accounts/{accountId}/tenants/{tenantId}", path: "/accounts/84/tenants/42",
			view: organizationtenancy.ReadAccountTenants, want: organizationtenancy.OperatorReadAccess{AccountID: 84, SchoolID: 42}},
		{name: "school access revoke", method: http.MethodDelete, pattern: "/accounts/{accountId}/tenants/{tenantId}", path: "/accounts/84/tenants/42",
			view: organizationtenancy.ReadAccountTenants, want: organizationtenancy.OperatorReadAccess{AccountID: 84, SchoolID: 42}},
		{name: "school access list", method: http.MethodGet, pattern: "/accounts/{accountId}/tenants", path: "/accounts/84/tenants",
			view: organizationtenancy.ReadAccountTenants, want: organizationtenancy.OperatorReadAccess{AccountID: 84}},
		{name: "scan resolve", method: http.MethodPost, pattern: "/unregistered-tag-scans/{id}/resolve", path: "/unregistered-tag-scans/123/resolve",
			view: organizationtenancy.ReadUnregisteredTagScans, want: organizationtenancy.OperatorReadAccess{TagScanID: 123}},
		{name: "scan list", method: http.MethodGet, pattern: "/unregistered-tag-scans", path: "/unregistered-tag-scans",
			view: organizationtenancy.ReadUnregisteredTagScans, want: organizationtenancy.OperatorReadAccess{}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			svc := &readAuditService{}
			resource := NewProvisioningResource(ProvisioningConfig{Service: svc})
			router := chi.NewRouter()
			router.MethodFunc(tc.method, tc.pattern, resource.AuditReadAccess(tc.view, func(w http.ResponseWriter, _ *http.Request) {
				w.WriteHeader(http.StatusNoContent)
			}))
			req := httptest.NewRequest(tc.method, tc.path, nil)
			req = req.WithContext(context.WithValue(req.Context(), sessiontoken.CtxClaims, sessiontoken.AppClaims{ID: 7, Scope: "platform"}))
			response := httptest.NewRecorder()
			router.ServeHTTP(response, req)

			assert.Equal(t, http.StatusNoContent, response.Code)
			require.Len(t, svc.entries, 1)
			want := tc.want
			want.View, want.OperatorID, want.ClientIP = tc.view, 7, svc.entries[0].ClientIP
			assert.Equal(t, want, svc.entries[0])
		})
	}
}

// TestOperatorReadAuditRejectsAMalformedRouteObject keeps a malformed ID out
// of the audit and away from the handler.
func TestOperatorReadAuditRejectsAMalformedRouteObject(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct {
		pattern, path string
		view          organizationtenancy.OperatorReadView
	}{
		{pattern: "/accounts/{accountId}/tenants/{tenantId}", path: "/accounts/84/tenants/x", view: organizationtenancy.ReadAccountTenants},
		{pattern: "/unregistered-tag-scans/{id}/resolve", path: "/unregistered-tag-scans/x/resolve", view: organizationtenancy.ReadUnregisteredTagScans},
	} {
		svc := &readAuditService{}
		resource := NewProvisioningResource(ProvisioningConfig{Service: svc})
		router := chi.NewRouter()
		router.Post(tc.pattern, resource.AuditReadAccess(tc.view, func(http.ResponseWriter, *http.Request) {
			t.Fatal("handler reached with a malformed ID")
		}))
		req := httptest.NewRequest(http.MethodPost, tc.path, nil)
		req = req.WithContext(context.WithValue(req.Context(), sessiontoken.CtxClaims, sessiontoken.AppClaims{ID: 7, Scope: "platform"}))
		response := httptest.NewRecorder()
		router.ServeHTTP(response, req)
		assert.Equal(t, http.StatusBadRequest, response.Code, tc.path)
		assert.Empty(t, svc.entries, tc.path)
	}
}
