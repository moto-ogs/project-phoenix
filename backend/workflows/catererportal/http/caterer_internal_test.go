package catererportalhttp

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

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

// confirmingPortal records the confirmation the route hands on.
type confirmingPortal struct {
	catererportal.Portal
	accountID, schoolID, orderID int64
}

func (p *confirmingPortal) ConfirmOrder(_ context.Context, accountID, schoolID, orderID int64) error {
	p.accountID, p.schoolID, p.orderID = accountID, schoolID, orderID
	return nil
}

// The caterer confirms one order of one school under /caterer: the route
// hands the session's caterer account, the school and the order on and
// answers no data.
func TestConfirmOrderHandsTheCatererAndTheOrderOn(t *testing.T) {
	t.Parallel()
	portal := &confirmingPortal{}
	router := chi.NewRouter()
	router.Mount("/caterer", NewResource(portal, Runtime{
		CurrentAccountID: func(context.Context) int64 { return 42 },
		RenderList:       func(mealplan.ListExport, string) (ExportFile, error) { return ExportFile{}, nil },
		Auth:             noAuthRoutes{},
	}).CatererRouter(nil, func(chi.Router) {}))
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, httptest.NewRequest(http.MethodPost, "/caterer/schools/11/orders/7/confirm", nil))

	require.Equal(t, http.StatusNoContent, recorder.Code, recorder.Body.String())
	assert.Equal(t, [3]int64{42, 11, 7}, [3]int64{portal.accountID, portal.schoolID, portal.orderID})
}

func TestSummaryFailureUsesTheDetailErrorCodeWithoutDiagnostics(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct {
		cause  error
		status int
		code   string
	}{
		{mealplan.ErrDisabled, http.StatusForbidden, "meals.plan_disabled"},
		{mealplan.ErrRegistrationDisabled, http.StatusForbidden, "meals.registration_disabled"},
		{errors.New("unavailable database"), http.StatusInternalServerError, "general.server"},
	} {
		request := httptest.NewRequest(http.MethodGet, "/schools", nil)
		failure := summaryFailure(request, catererportal.SchoolSummary{Failure: tc.cause})
		require.Equal(t, &SummaryFailureResponse{Status: tc.status, Code: tc.code}, failure)
	}
}
