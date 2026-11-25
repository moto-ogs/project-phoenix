package api

import (
	"context"
	"log/slog"

	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/auth/authorize/permissions"
	"github.com/moto-ogs/project-phoenix/modules/facilities"
	"github.com/moto-ogs/project-phoenix/modules/grouplive"
	"github.com/moto-ogs/project-phoenix/modules/securityruntime"
	"github.com/moto-ogs/project-phoenix/modules/studentpresence"
	"github.com/moto-ogs/project-phoenix/modules/supervisiondashboard"
	"github.com/moto-ogs/project-phoenix/modules/timetable"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
	"github.com/moto-ogs/project-phoenix/tenant"
)

type supervisionContextPresence interface {
	QueryLiveGroups(context.Context, studentpresence.LiveGroupFilter) ([]studentpresence.LiveGroup, error)
}

type supervisionContextRooms interface {
	ListRooms(context.Context, facilities.RoomFilter) ([]facilities.Room, error)
	ListRoomsByID(context.Context, []int64) ([]facilities.Room, error)
}

type supervisionContextSessions struct {
	staffID    func(context.Context) (int64, bool, error)
	settings   securityruntime.OverviewSettings
	presence   supervisionContextPresence
	rooms      supervisionContextRooms
	activities interface {
		ListGroups(context.Context, timetable.GroupFilter) ([]timetable.Group, error)
	}
}

func supervisionContextReader(groups func(context.Context) (grouplive.NavigationContext, error), sessions supervisionContextSessions, assignments studentpresence.StaffSupervisionAssignments, logger *slog.Logger) supervisiondashboard.ContextReader {
	return supervisiondashboard.ContextReader{
		Groups: func(ctx context.Context) (supervisiondashboard.ContextGroups, error) {
			groupContext, err := groups(ctx)
			if err != nil {
				return supervisiondashboard.ContextGroups{}, err
			}
			navigation := make([]supervisiondashboard.ContextNavigationGroup, 0, len(groupContext.Groups))
			for _, group := range groupContext.Groups {
				navigation = append(navigation, supervisiondashboard.ContextNavigationGroup(group))
			}
			return supervisiondashboard.ContextGroups{Navigation: navigation, OwnGroupIDs: groupContext.OwnGroupIDs, OwnRoomNames: groupContext.OwnRoomNames}, nil
		},
		Sessions:      sessions,
		OwnSessionIDs: assignments.StaffSupervisionSessionIDs,
		ReleasedRooms: func(ctx context.Context) ([]supervisiondashboard.ContextRoom, error) {
			rooms, err := sessions.rooms.ListRooms(ctx, facilities.RoomFilter{IsOpenRoom: new(true), ExcludeSystem: true})
			if err != nil {
				return nil, err
			}
			result := make([]supervisiondashboard.ContextRoom, 0, len(rooms))
			for _, room := range rooms {
				result = append(result, supervisiondashboard.ContextRoom{ID: ident.ID(room.ID), Name: room.Name})
			}
			return result, nil
		},
		CanReadRooms: func(ctx context.Context) bool {
			principal, err := common.CurrentPrincipal(ctx)
			return err == nil && principal.HasPermission(permissions.RoomsRead)
		},
		Savepoint: tenant.WithSavepoint, Fatal: tenant.IsSavepointControlFailure, Logger: logger,
	}
}

func (s supervisionContextSessions) StaffID(ctx context.Context) (int64, error) {
	id, found, err := s.staffID(ctx)
	if !found {
		return 0, err
	}
	return id, err
}

func (s supervisionContextSessions) CanReadOverview(ctx context.Context, staffID int64, staffErr error) (bool, error) {
	principal, err := common.CurrentPrincipal(ctx)
	if err != nil || !principal.HasPermission(permissions.GroupsRead) {
		return false, err
	}
	admin := principal.HasAdminScope()
	// On a failed identity lookup, check whether eligibility actually depends
	// on staff linkage, but never grant access on an unverified linkage.
	allowed, err := securityruntime.HasOperationalOverviewForResolvedStaff(ctx, s.settings, common.IsAssignmentBoundPortal(ctx), admin, staffID > 0 || staffErr != nil)
	if err == nil && allowed && !admin && staffErr != nil {
		return false, staffErr
	}
	return allowed, err
}

func (s supervisionContextSessions) OpenSessions(ctx context.Context, ids []int64) ([]supervisiondashboard.ContextSession, error) {
	rows, err := s.presence.QueryLiveGroups(ctx, studentpresence.LiveGroupFilter{OpenOnly: true, IDs: ids})
	if err != nil || len(rows) == 0 {
		return nil, err
	}
	roomIDs := make([]int64, 0, len(rows))
	var activityIDs []int64
	for _, row := range rows {
		roomIDs = append(roomIDs, row.RoomID)
		if row.ActivityGroupID != nil {
			activityIDs = append(activityIDs, *row.ActivityGroupID)
		}
	}
	rooms, err := s.rooms.ListRoomsByID(ctx, roomIDs)
	if err != nil {
		return nil, err
	}
	roomNames := make(map[int64]string, len(rooms))
	for _, room := range rooms {
		roomNames[room.ID] = room.Name
	}
	activityNames := make(map[int64]string)
	if len(activityIDs) != 0 {
		activities, err := s.activities.ListGroups(ctx, timetable.GroupFilter{IDs: activityIDs})
		if err != nil {
			return nil, err
		}
		for _, activity := range activities {
			activityNames[activity.ID] = activity.Name
		}
	}
	result := make([]supervisiondashboard.ContextSession, 0, len(rows))
	for _, row := range rows {
		item := supervisiondashboard.ContextSession{ID: ident.ID(row.ID), RoomID: ident.ID(row.RoomID), RoomName: roomNames[row.RoomID]}
		if row.ActivityGroupID != nil {
			item.ActivityName = activityNames[*row.ActivityGroupID]
		}
		result = append(result, item)
	}
	return result, nil
}
