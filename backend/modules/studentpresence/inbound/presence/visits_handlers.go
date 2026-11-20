package presence

import (
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/modules/studentpresence"
)

// ===== Visit Handlers =====

// listVisits handles listing all visits
func (rs *Resource) listVisits(w http.ResponseWriter, r *http.Request) {
	// Get query parameters
	filter := studentpresence.VisitFilter{}

	// Get active status filter
	activeStr := r.URL.Query().Get("active")
	if activeStr != "" {
		isActive := activeStr == "true" || activeStr == "1"
		if isActive {
			// For active visits, exit_time should be NULL
			filter.OpenOnly = true
		} else {
			// For inactive visits, exit_time should NOT be NULL
			filter.ClosedOnly = true
		}
	}

	activeGroupIDs, ok := parseActiveGroupIDs(w, r)
	if !ok {
		return
	}
	if len(activeGroupIDs) > 0 {
		filter.ActiveGroupIDs = activeGroupIDs
	}

	// Get visits
	visits, err := rs.listReadableVisits(r.Context(), filter)
	if err != nil {
		common.RenderError(w, r, common.ErrorInternalServer(presenceQueryError("ListVisits", err)))
		return
	}

	// Build response
	responses := make([]VisitResponse, 0, len(visits))
	for _, visit := range visits {
		responses = append(responses, newPresenceVisitResponse(visit))
	}

	common.Respond(w, r, http.StatusOK, responses, "Visits retrieved successfully")
}

// parseActiveGroupIDs parses the comma-separated active_group_ids query
// parameter used by room moves to load visits for several source sessions in
// one request. Invalid IDs are rejected rather than silently skipped.
func parseActiveGroupIDs(w http.ResponseWriter, r *http.Request) ([]int64, bool) {
	raw := r.URL.Query().Get("active_group_ids")
	if raw == "" {
		return nil, true
	}

	parts := strings.Split(raw, ",")
	ids := make([]int64, 0, len(parts))
	for _, part := range parts {
		id, err := strconv.ParseInt(strings.TrimSpace(part), 10, 64)
		if err != nil || id <= 0 {
			common.RenderError(w, r, common.ErrorInvalidRequest(errors.New(errMsgInvalidGroupID)))
			return nil, false
		}
		ids = append(ids, id)
	}
	return ids, true
}
