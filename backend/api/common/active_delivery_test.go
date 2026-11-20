package common

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/moto-ogs/project-phoenix/auth/authorize/permissions"
)

func TestActiveDeliveryPermissionMappings(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct {
		name       string
		permission string
		guard      func() Middleware
	}{
		{"group read", permissions.GroupsRead, RequireActiveGroupRead},
		{"group update", permissions.GroupsUpdate, RequireActiveGroupUpdate},
		{"visit update", permissions.VisitsUpdate, RequireVisitUpdate},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			for _, scenario := range []struct {
				granted       []string
				authenticated bool
				want          int
			}{
				{granted: []string{tc.permission}, authenticated: true, want: http.StatusNoContent},
				{granted: []string{"unrelated:read"}, authenticated: true, want: http.StatusForbidden},
				{want: http.StatusUnauthorized},
			} {
				req := httptest.NewRequest(http.MethodGet, "/", nil)
				if scenario.authenticated {
					principal, err := permissions.NewPrincipal(permissions.PrincipalInput{AccountID: 1, TenantID: 2, Permissions: scenario.granted})
					if err != nil {
						t.Fatal(err)
					}
					req = req.WithContext(permissions.WithPrincipal(req.Context(), principal))
				}
				recorder := httptest.NewRecorder()
				tc.guard()(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNoContent) })).ServeHTTP(recorder, req)
				if recorder.Code != scenario.want {
					t.Fatalf("grant %v, authenticated %v: status %d, want %d", scenario.granted, scenario.authenticated, recorder.Code, scenario.want)
				}
			}
		})
	}
}
