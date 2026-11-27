package presence

import (
	"errors"
	"net/http"

	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/modules/studentpresence"
)

// ===== Supervisor Handlers =====

// getStaffActiveSupervisions handles getting active supervisions for a staff member
func (rs *Resource) getStaffActiveSupervisions(w http.ResponseWriter, r *http.Request) {
	// Parse staff ID from URL
	staffID, err := common.ParseIDParam(r, "staffId")
	if err != nil {
		common.RenderError(w, r, common.ErrorInvalidRequest(errors.New("invalid staff ID")))
		return
	}

	// Get active supervisions for staff
	day := rs.today().String()
	responses, err := rs.presenceSupervisionResponses(r.Context(), studentpresence.GroupSupervisionFilter{StaffID: &staffID, ActiveOn: &day}, "GetStaffActiveSupervisions")
	if err != nil {
		common.RenderError(w, r, ErrorRenderer(err))
		return
	}

	filtered := responses[:0]
	for _, response := range responses {
		if response.IsActive {
			filtered = append(filtered, response)
		}
	}
	responses = filtered

	common.Respond(w, r, http.StatusOK, responses, "Staff active supervisions retrieved successfully")
}

// endSupervision handles ending a supervision
func (rs *Resource) endSupervision(w http.ResponseWriter, r *http.Request) {
	// Parse ID from URL
	id, err := common.ParseID(r)
	if err != nil {
		common.RenderError(w, r, common.ErrorInvalidRequest(errors.New(errMsgInvalidSupervisorID)))
		return
	}

	// End supervision
	if err := rs.Operations.EndSupervision(r.Context(), id); err != nil {
		common.RenderError(w, r, ErrorRenderer(err))
		return
	}

	// Get the updated supervisor
	response, err := rs.presenceSupervisor(r.Context(), id)
	if err != nil {
		// A typed nil writes "data": null, the contract's answer without a
		// supervisor; a bare nil drops the member.
		common.Respond(w, r, http.StatusOK, (*SupervisorResponse)(nil), "Supervision ended successfully")
		return
	}

	// Return the updated supervisor
	common.Respond(w, r, http.StatusOK, response, "Supervision ended successfully")
}
