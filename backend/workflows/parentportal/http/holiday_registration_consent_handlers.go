package parent

import (
	"errors"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/render"

	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess/sessiontoken"
	parentService "github.com/moto-ogs/project-phoenix/workflows/parentportal"
)

// HolidayRegistrationConsentRequest withdraws (given false) or gives again
// (given true) a voluntary consent of a holiday registration (#8038, ADR
// 0321).
type HolidayRegistrationConsentRequest struct {
	Given *bool `json:"given"`
}

// Bind requires the state the consent shall have.
func (req *HolidayRegistrationConsentRequest) Bind(*http.Request) error {
	if req.Given == nil {
		return errors.New("given is required")
	}
	return nil
}

// setHolidayRegistrationConsent serves PUT
// /parent/me/holiday-registration-entries/{registrationId}/consents/{key}:
// the parents withdraw a voluntary consent of their registration or give it
// again. The account comes from the claims only; a registration of another
// account or a consent its form does not ask answers 404.
func (rs *Resource) setHolidayRegistrationConsent(w http.ResponseWriter, r *http.Request) {
	if rs.ParentService == nil {
		common.RenderError(w, r, common.ErrorInternalServer(errors.New("parent holiday registration entries not configured")))
		return
	}
	claims := sessiontoken.ClaimsFromCtx(r.Context())
	if claims.ID == 0 {
		common.RenderError(w, r, common.ErrorUnauthorized(sessiontoken.ErrTokenUnauthorized))
		return
	}
	registrationID, err := common.ParseIDParam(r, "registrationId")
	if err != nil {
		common.RenderError(w, r, common.ErrorInvalidRequest(err))
		return
	}
	key := strings.TrimSpace(chi.URLParam(r, "key"))
	req := &HolidayRegistrationConsentRequest{}
	if err := render.Bind(r, req); err != nil {
		common.RenderError(w, r, common.ErrorInvalidRequest(err))
		return
	}
	err = rs.ParentService.ChangeHolidayRegistrationConsent(r.Context(), int64(claims.ID), registrationID, key, *req.Given)
	switch {
	case errors.Is(err, parentService.ErrHolidayRegistrationConsentNotFound):
		common.RenderError(w, r, common.ErrorNotFoundWithCode(err, common.CodeEnrollmentHolidayRegistrationEntryNotFound))
	case err != nil:
		common.RenderError(w, r, common.ErrorInternalServer(err))
	default:
		common.Respond(w, r, http.StatusNoContent, nil, "")
	}
}
