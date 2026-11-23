package account

import (
	"errors"
	"net/http"

	"github.com/go-chi/render"

	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess"
)

// Role Management Request/Response Types

func (rs *Resource) getCaregiverCapability(w http.ResponseWriter, r *http.Request) {
	if rs.CaregiverCapabilityService == nil {
		common.RenderError(w, r, common.ErrorInternalServer(errors.New("caregiver capability service is not configured")))
		return
	}

	accountID, ok := common.ParseInt64IDWithError(w, r, "accountId", common.MsgInvalidAccountID)
	if !ok {
		return
	}

	state, err := rs.CaregiverCapabilityService.GetCaregiverCapability(r.Context(), accountID)
	if err != nil {
		common.RenderError(w, r, caregiverCapabilityErrorRenderer(err))
		return
	}

	common.Respond(w, r, http.StatusOK, state, "Caregiver capability retrieved successfully")
}

func (rs *Resource) enableCaregiverCapability(w http.ResponseWriter, r *http.Request) {
	if rs.CaregiverCapabilityService == nil {
		common.RenderError(w, r, common.ErrorInternalServer(errors.New("caregiver capability service is not configured")))
		return
	}

	accountID, ok := common.ParseInt64IDWithError(w, r, "accountId", common.MsgInvalidAccountID)
	if !ok {
		return
	}

	req := &EnableCaregiverCapabilityRequest{}
	if err := render.Bind(r, req); err != nil {
		common.RenderError(w, r, common.ErrorInvalidRequest(err))
		return
	}

	state, err := rs.CaregiverCapabilityService.EnableCaregiverCapability(r.Context(), accountID, req.FirstName, req.LastName, req.Position)
	if err != nil {
		common.RenderError(w, r, caregiverCapabilityErrorRenderer(err))
		return
	}

	common.Respond(w, r, http.StatusOK, state, "Caregiver capability enabled successfully")
}

func (rs *Resource) disableCaregiverCapability(w http.ResponseWriter, r *http.Request) {
	if rs.CaregiverCapabilityService == nil {
		common.RenderError(w, r, common.ErrorInternalServer(errors.New("caregiver capability service is not configured")))
		return
	}

	accountID, ok := common.ParseInt64IDWithError(w, r, "accountId", common.MsgInvalidAccountID)
	if !ok {
		return
	}

	state, err := rs.CaregiverCapabilityService.DisableCaregiverCapability(r.Context(), accountID)
	if err != nil {
		common.RenderError(w, r, caregiverCapabilityErrorRenderer(err))
		return
	}

	common.Respond(w, r, http.StatusOK, state, "Caregiver capability disabled successfully")
}

func caregiverCapabilityErrorRenderer(err error) render.Renderer {
	if blocked, ok := errors.AsType[caregiverCapabilityBlocked](err); ok {
		return common.NewCaregiverCapabilityBlockedResponse(
			http.StatusConflict,
			blocked.Error(),
			blocked.CaregiverCapabilityBlockers(),
		)
	}
	// The caregiver capability is People Directory's and reports its own
	// missing account; the account administration reports Identity &
	// Access's.
	if _, missing := errors.AsType[caregiverAccountMissing](err); missing || errors.Is(err, identityaccess.ErrAccountNotFound) {
		return common.ErrorNotFound(errors.New("account not found"))
	}
	if invalid, ok := errors.AsType[caregiverRequestInvalid](err); ok {
		return common.ErrorInvalidRequest(invalid.CaregiverRequestInvalid())
	}
	if failure, ok := errors.AsType[caregiverFailure](err); ok {
		return common.ErrorInternalServer(failure.CaregiverFailure())
	}
	return common.ErrorInternalServer(err)
}

// Permission Management Endpoints

// Password Reset Endpoints
