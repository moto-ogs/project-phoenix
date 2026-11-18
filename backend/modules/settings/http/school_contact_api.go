package settingshttp

import (
	"context"
	"errors"
	"net/http"
)

// SchoolContactEmail reads the contact address of a school (Organisation &
// Tenancy), bound at the root (#7176).
type SchoolContactEmail func(ctx context.Context, tenantID int64) (string, error)

type schoolContactEmailResponse struct {
	Email string `json:"email"`
}

// getSchoolContactEmail answers the contact address of the caller's school.
// The settings screen prefills the recipients of new-enrollment e-mails with
// it when the online form is switched on (#7176). An empty address is a valid
// answer: the field then stays empty.
func (rs *SettingsResource) getSchoolContactEmail(w http.ResponseWriter, r *http.Request) {
	tenantID := rs.runtime.Actor(r.Context()).TenantID
	if tenantID <= 0 {
		rs.runtime.RenderError(w, r, http.StatusBadRequest, errors.New("no tenant context"))
		return
	}
	if rs.schoolContact == nil {
		rs.runtime.RenderError(w, r, http.StatusInternalServerError, errors.New("school contact address is not configured"))
		return
	}
	email, err := rs.schoolContact(r.Context(), tenantID)
	if err != nil {
		rs.runtime.RenderError(w, r, http.StatusInternalServerError, err)
		return
	}
	rs.runtime.Respond(w, r, http.StatusOK, schoolContactEmailResponse{Email: email}, "")
}
