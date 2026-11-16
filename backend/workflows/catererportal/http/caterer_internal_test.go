package catererportalhttp

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/modules/identityaccess"
	"github.com/moto-ogs/project-phoenix/modules/mealplan"
	"github.com/moto-ogs/project-phoenix/workflows/catererportal"
)

// acceptingPortal records the acceptance the route hands on.
type acceptingPortal struct {
	catererportal.Portal
	schoolID     int64
	token        string
	registration identityaccess.CatererRegistration
	err          error
}

func (p *acceptingPortal) AcceptInvitation(_ context.Context, schoolID int64, token string, registration identityaccess.CatererRegistration) error {
	p.schoolID, p.token, p.registration = schoolID, token, registration
	return p.err
}

// #4496: the acceptance route hands the caller's address and browser on, so
// a refused password is audited like a refused login, and answers it as one.
func TestAcceptInvitationPassesTheCallerForTheAudit(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct {
		name string
		err  error
		code int
	}{
		{name: "accepted", code: http.StatusNoContent},
		{name: "refused", err: identityaccess.ErrInvalidCredentials, code: http.StatusUnauthorized},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			portal := &acceptingPortal{err: tc.err}
			router := NewResource(portal, Runtime{
				CurrentAccountID: func(context.Context) int64 { return 0 },
				RenderList:       func(mealplan.ListExport, string) (ExportFile, error) { return ExportFile{}, nil },
				Auth:             noAuthRoutes{},
				Now:              func() time.Time { return time.Date(2026, time.November, 16, 12, 0, 0, 0, time.UTC) },
			}).CatererRouter(nil, func(chi.Router) {})
			request := httptest.NewRequest(http.MethodPost, "/invitations/11/link-token/accept", strings.NewReader(`{"password":"geheim"}`))
			request.RemoteAddr = "192.0.2.44:5123"
			request.Header.Set("User-Agent", "Caterer-Browser")
			recorder := httptest.NewRecorder()
			router.ServeHTTP(recorder, request)

			require.Equal(t, tc.code, recorder.Code)
			assert.Equal(t, int64(11), portal.schoolID)
			assert.Equal(t, "link-token", portal.token)
			assert.Equal(t, "geheim", portal.registration.Password)
			assert.Equal(t, "192.0.2.44", portal.registration.IPAddress)
			assert.Equal(t, "Caterer-Browser", portal.registration.UserAgent)
		})
	}
}
