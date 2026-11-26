package account

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

type lookupSchoolDirectory struct {
	SchoolDirectory
	school *TenantSchool
	err    error
}

func (d lookupSchoolDirectory) GetSchoolBySubdomain(context.Context, string) (*TenantSchool, error) {
	return d.school, d.err
}

func TestTenantLookupStatus(t *testing.T) {
	t.Parallel()
	for _, tt := range []struct {
		name   string
		school *TenantSchool
		err    error
		status int
	}{
		{name: "organization read failed", err: errors.New("organization lookup failed"), status: http.StatusInternalServerError},
		{name: "missing", status: http.StatusNotFound},
		{name: "invalid subdomain", err: ErrInvalidSchoolSubdomain, status: http.StatusBadRequest},
		{name: "inactive", school: &TenantSchool{}, status: http.StatusNotFound},
		{name: "deleted", school: &TenantSchool{Active: true, Deleted: true}, status: http.StatusNotFound},
	} {
		t.Run(tt.name, func(t *testing.T) {
			resource := Resource{SchoolService: lookupSchoolDirectory{school: tt.school, err: tt.err}}
			recorder := httptest.NewRecorder()
			resource.resolveTenant(recorder, httptest.NewRequest(http.MethodGet, "/auth/tenant/resolve?slug=school-a", nil))
			if recorder.Code != tt.status {
				t.Fatalf("status = %d, want %d", recorder.Code, tt.status)
			}
		})
	}
}
