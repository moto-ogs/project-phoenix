package catererportalhttp

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess"
	"github.com/moto-ogs/project-phoenix/modules/mealplan"
	"github.com/moto-ogs/project-phoenix/workflows/catererportal"
	"github.com/stretchr/testify/require"
)

// schoolCatererPortal serves one school caterer page; the other portal calls
// are not reached.
type schoolCatererPortal struct {
	catererportal.Portal
	caterer catererportal.SchoolCaterer
}

func (p schoolCatererPortal) SchoolCaterer(context.Context) (catererportal.SchoolCaterer, error) {
	return p.caterer, nil
}

type noAuthRoutes struct{}

func (noAuthRoutes) MountSignIn(chi.Router)           {}
func (noAuthRoutes) MountSession(chi.Router)          {}
func (noAuthRoutes) MountCredentialChecks(chi.Router) {}

// An invitation's status shows the expiry Identity & Access judged on the
// database clock that stamps it (ADR 0285), not the machine's clock; an
// accepted or revoked invitation keeps that status after its expiry.
func TestSchoolCatererShowsTheExpiryIdentityJudged(t *testing.T) {
	t.Parallel()
	expiresAt := time.Date(2031, time.June, 2, 12, 0, 0, 0, time.UTC)
	acceptedAt := expiresAt.Add(-time.Hour)
	for _, tc := range []struct {
		name       string
		expired    bool
		acceptedAt *time.Time
		status     string
	}{
		{name: "open", status: "open"},
		{name: "expired", expired: true, status: "expired"},
		{name: "accepted before expiry", expired: true, acceptedAt: &acceptedAt, status: "accepted"},
	} {
		portal := schoolCatererPortal{caterer: catererportal.SchoolCaterer{Invitations: []identityaccess.CatererInvitation{{
			ID: 7, Email: "kueche@example.org", CatererName: "Küche", ExpiresAt: expiresAt,
			CreatedAt: expiresAt.Add(-72 * time.Hour), AcceptedAt: tc.acceptedAt, Expired: tc.expired,
		}}}}
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			resource := NewResource(portal, Runtime{
				CurrentAccountID: func(context.Context) int64 { return 1 },
				RenderList:       func(mealplan.ListExport, string) (ExportFile, error) { return ExportFile{}, nil },
				Auth:             noAuthRoutes{},
			})
			recorder := httptest.NewRecorder()
			resource.getSchoolCaterer(recorder, httptest.NewRequest(http.MethodGet, "/", nil))

			require.Equal(t, http.StatusOK, recorder.Code)
			var body struct {
				Data SchoolCatererResponse `json:"data"`
			}
			require.NoError(t, json.Unmarshal(recorder.Body.Bytes(), &body))
			require.Len(t, body.Data.Invitations, 1)
			require.Equal(t, tc.status, body.Data.Invitations[0].Status)
		})
	}
}
