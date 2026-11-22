package presence

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"

	"github.com/go-chi/render"
	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/modules/studentpresence"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

// ===== Active Group Handlers =====

// listActiveGroups handles listing all active groups
func (rs *Resource) listActiveGroups(w http.ResponseWriter, r *http.Request) {
	queryOptions := rs.parseActiveGroupQueryParams(r)

	groups, err := rs.listPresenceLiveGroups(r.Context(), queryOptions)
	if err != nil {
		common.RenderError(w, r, common.ErrorInternalServer(err))
		return
	}

	responses := make([]ActiveGroupResponse, 0, len(groups))
	for _, group := range groups {
		responses = append(responses, newPresenceLiveGroupResponse(group))
	}
	includeRelations := r.URL.Query().Get("active") == "true" || r.URL.Query().Get("is_active") == "true"
	if includeRelations && len(groups) > 0 {
		rs.loadActiveGroupRelations(r.Context(), groups, responses)
	}

	common.Respond(w, r, http.StatusOK, responses, "Active groups retrieved successfully")
}

// parseActiveGroupQueryParams parses query parameters for active groups
func (rs *Resource) parseActiveGroupQueryParams(r *http.Request) studentpresence.LiveGroupFilter {
	options := studentpresence.LiveGroupFilter{}
	if value := r.URL.Query().Get("active"); value != "" {
		isActive := value == "true" || value == "1"
		options.OpenOnly, options.EndedOnly = isActive, !isActive
	}
	return options
}

// loadActiveGroupRelations loads rooms and supervisors for active groups
func (rs *Resource) loadActiveGroupRelations(ctx context.Context, groups []studentpresence.LiveGroup, responses []ActiveGroupResponse) {
	roomMap := rs.loadRoomsMap(ctx, groups)
	supervisorMap := rs.loadActiveSupervisorsMap(ctx, groups)

	for i, group := range groups {
		if supervisors, ok := supervisorMap[group.ID]; ok {
			responses[i].Supervisors = supervisors
			responses[i].SupervisorCount = len(responses[i].Supervisors)
		}
		if room, ok := roomMap[group.RoomID]; ok {
			responses[i].Room = newSessionRoomResponse(room)
		}
	}
}

// loadRoomsMap loads rooms and returns a map of room ID to room
func (rs *Resource) loadRoomsMap(ctx context.Context, groups []studentpresence.LiveGroup) map[int64]studentpresence.SessionRoomSummary {
	roomIDs := rs.collectUniqueRoomIDs(groups)
	roomMap := make(map[int64]studentpresence.SessionRoomSummary)

	if len(roomIDs) > 0 {
		rooms, err := rs.Operations.SessionRooms(ctx, roomIDs)
		if err == nil {
			for _, room := range rooms {
				roomMap[room.ID] = room
			}
		}
	}

	return roomMap
}

// collectUniqueRoomIDs collects unique room IDs from groups
func (rs *Resource) collectUniqueRoomIDs(groups []studentpresence.LiveGroup) []int64 {
	roomIDs := make([]int64, 0, len(groups))
	roomIDMap := make(map[int64]bool)

	for _, group := range groups {
		if group.RoomID > 0 && !roomIDMap[group.RoomID] {
			roomIDs = append(roomIDs, group.RoomID)
			roomIDMap[group.RoomID] = true
		}
	}

	return roomIDs
}

// loadActiveSupervisorsMap loads supervisors and returns a map of group ID to active supervisors
func (rs *Resource) loadActiveSupervisorsMap(ctx context.Context, groups []studentpresence.LiveGroup) map[int64][]GroupSupervisorSimple {
	supervisorMap := make(map[int64][]GroupSupervisorSimple)
	if len(groups) == 0 {
		return supervisorMap
	}
	groupIDs := make([]int64, len(groups))
	for i, group := range groups {
		groupIDs[i] = group.ID
	}
	day := rs.today().String()
	rows, err := rs.Presence.QueryGroupSupervisions(ctx, studentpresence.GroupSupervisionFilter{GroupIDs: groupIDs, ActiveOn: &day})
	if err != nil {
		slog.Default().Error("failed to load supervisors", slog.String("error", err.Error()))
		return supervisorMap
	}
	today := rs.today()
	for _, row := range rows {
		response, err := presenceSupervisionResponse(row, today)
		if err != nil {
			slog.Default().Error("failed to load supervisors", slog.String("error", err.Error()))
			return make(map[int64][]GroupSupervisorSimple)
		}
		if response.IsActive {
			supervisorMap[row.GroupID] = append(supervisorMap[row.GroupID], GroupSupervisorSimple{StaffID: ident.ID(row.StaffID), Role: row.Role})
		}
	}
	return supervisorMap
}

// errNoStaffRecord refuses a valid session whose account has no person or no
// staff record at the school, a Träger-Büro session through the Absprung
// included: the action is the school staff's own. It is the caller's gap
// (403), not a missing session (401) and not a failed lookup (500).
var errNoStaffRecord = errors.New("user is not a staff member")

// errNoSessionPrincipal is a request without a validated session; the
// middleware normally rejects it before the handler runs.
var errNoSessionPrincipal = errors.New("account not found")

// extractStaffFromRequest resolves staff for the validated account and
// answers a refusal with a plain 403.
func (rs *Resource) extractStaffFromRequest(w http.ResponseWriter, r *http.Request) (*StaffIdentity, error) {
	staff, err := rs.resolveRequestStaff(r)
	if err != nil {
		renderStaffResolutionError(w, r, err, common.ErrorForbidden(err))
	}
	return staff, err
}

// resolveRequestStaff finds the staff record of the validated account. The
// People port reports a missing person or staff record as nil without an
// error; any error is a failed lookup.
func (rs *Resource) resolveRequestStaff(r *http.Request) (*StaffIdentity, error) {
	principal, err := common.CurrentPrincipal(r.Context())
	if err != nil {
		return nil, errNoSessionPrincipal
	}
	person, err := rs.PersonService.FindByAccountID(r.Context(), principal.AccountID())
	if err != nil {
		return nil, fmt.Errorf("find person by account: %w", err)
	}
	if person == nil {
		return nil, errNoStaffRecord
	}
	staff, err := rs.PersonService.GetStaffByPersonID(r.Context(), person.ID)
	if err != nil {
		return nil, fmt.Errorf("find staff by person: %w", err)
	}
	if staff == nil {
		return nil, errNoStaffRecord
	}
	return staff, nil
}

// renderStaffResolutionError answers a failed resolveRequestStaff: refusal
// for an account without a staff record, 401 only without a validated
// session, 500 for a failed lookup.
func renderStaffResolutionError(w http.ResponseWriter, r *http.Request, err error, refusal render.Renderer) {
	switch {
	case errors.Is(err, errNoStaffRecord):
		common.RenderError(w, r, refusal)
	case errors.Is(err, errNoSessionPrincipal):
		common.RenderError(w, r, common.ErrorUnauthorized(err))
	default:
		common.RenderError(w, r, common.ErrorInternalServer(err))
	}
}

// getActiveGroupSupervisors handles getting supervisors for an active group
func (rs *Resource) getActiveGroupSupervisors(w http.ResponseWriter, r *http.Request) {
	// Parse ID from URL
	id, err := common.ParseID(r)
	if err != nil {
		common.RenderError(w, r, common.ErrorInvalidRequest(errors.New(errMsgInvalidActiveGroupID)))
		return
	}

	// Get active group with supervisors
	responses, err := rs.presenceSessionSupervisors(r.Context(), id, rs.today())
	if err != nil {
		common.RenderError(w, r, ErrorRenderer(err))
		return
	}

	common.Respond(w, r, http.StatusOK, responses, "Active group supervisors retrieved successfully")
}
