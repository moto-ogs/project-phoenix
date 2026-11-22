package presence

import (
	"context"
	"errors"
	"log/slog"
	"net/http"

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

// extractStaffFromRequest resolves staff for the validated account.
func (rs *Resource) extractStaffFromRequest(w http.ResponseWriter, r *http.Request) (*StaffIdentity, error) {
	principal, principalErr := common.CurrentPrincipal(r.Context())
	if principalErr != nil {
		common.RenderError(w, r, common.ErrorUnauthorized(errors.New("account not found")))
		return nil, errors.New("account not found")
	}

	person, err := rs.PersonService.FindByAccountID(r.Context(), principal.AccountID())
	if err != nil || person == nil {
		common.RenderError(w, r, common.ErrorUnauthorized(errors.New("account not found")))
		return nil, errors.New("account not found")
	}

	staff, err := rs.PersonService.GetStaffByPersonID(r.Context(), person.ID)
	if err != nil || staff == nil {
		common.RenderError(w, r, common.ErrorForbidden(errors.New("user is not a staff member")))
		return nil, errors.New("user is not a staff member")
	}

	return staff, nil
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
