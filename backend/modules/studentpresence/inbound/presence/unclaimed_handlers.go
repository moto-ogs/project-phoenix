package presence

import (
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/moto-ogs/project-phoenix/api/common"
)

// ======== Unclaimed Groups Management (Deviceless Claiming) ========

// claimGroup allows authenticated staff to claim supervision of an active group
func (rs *Resource) claimGroup(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	// Get group ID from URL
	groupIDStr := chi.URLParam(r, "id")
	groupID, err := strconv.ParseInt(groupIDStr, 10, 64)
	if err != nil {
		common.RespondWithError(w, r, http.StatusBadRequest, "Invalid group ID")
		return
	}

	// Taking over a supervision is the staff member's own: an account
	// without a staff record is refused (403), a failed lookup is a 500.
	staff, err := rs.extractStaffFromRequest(w, r)
	if err != nil {
		return
	}

	// Claim the group (default role: "supervisor")
	supervisor, err := rs.Operations.ClaimSupervision(ctx, groupID, staff.ID, "supervisor")
	if err != nil {
		common.RenderError(w, r, ErrorRenderer(err))
		return
	}

	common.Respond(w, r, http.StatusOK, newClaimedSupervisionResponse(supervisor), "Successfully claimed supervision")
}
