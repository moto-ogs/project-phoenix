package api

// The Räume source of "Heute anders" (#8161). The owner is Facilities: it
// holds the rooms the school closed for a day or a period (#7653) with the
// school's reason. The source applies the rule of the closure list
// GET /api/rooms/closures: rooms:read, or admin. An entry names the room and
// the reason, never a person. Staff portal and moto schule share it; only the
// staff portal links to the room's page, moto schule has none.

import (
	"context"
	"fmt"

	"github.com/moto-ogs/project-phoenix/auth/authorize/permissions"
	"github.com/moto-ogs/project-phoenix/modules/daychangesview"
	"github.com/moto-ogs/project-phoenix/modules/facilities"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess/sessiontoken"
	"github.com/moto-ogs/project-phoenix/modules/securityruntime"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

// dayChangesRoomClosureReads is Facilities' read of the closures with the
// room names, in one statement.
type dayChangesRoomClosureReads interface {
	ListRoomClosures(ctx context.Context, filter facilities.RoomClosureFilter) ([]facilities.RoomClosure, error)
}

// dayChangesPlannedRooms is Timetable's read of the rooms of the caller's
// own blocks of the day (#8234).
type dayChangesPlannedRooms interface {
	PlannedRoomIDs(ctx context.Context, staffID int64, date calendar.Date) ([]int64, error)
}

// dayChangesRoomClosures is the Räume source; linkRoom leads to the room's
// page of the staff portal. With planned and caller, a closure of a room the
// caller has an own block in today stands under "Betrifft dich" (#8234).
type dayChangesRoomClosures struct {
	reads    dayChangesRoomClosureReads
	linkRoom bool
	planned  dayChangesPlannedRooms
	caller   dayChangesCaller
}

// plannedRoomsOf is the planned-rooms read of Timetable's operational day
// behind the block read; nil when the composition has none.
func plannedRoomsOf(blocks dayChangesBlocks) dayChangesPlannedRooms {
	planned, _ := blocks.(dayChangesPlannedRooms)
	return planned
}

func (s dayChangesRoomClosures) RoomClosures(ctx context.Context, day calendar.Date) ([]daychangesview.SourceEntry, error) {
	granted := sessiontoken.PermissionsFromCtx(ctx)
	if !securityruntime.HasAdminWildcard(granted) && !securityruntime.HasPermission(permissions.RoomsRead, granted) {
		// The account reads no rooms: no entries, not a failure.
		return nil, nil
	}
	closures, err := s.reads.ListRoomClosures(ctx, facilities.RoomClosureFilter{
		From:                 day,
		Until:                day,
		ExcludeArchivedRooms: true,
	})
	if err != nil {
		return nil, fmt.Errorf("list room closures: %w", err)
	}
	own, err := s.ownRooms(ctx, day, len(closures))
	if err != nil {
		return nil, err
	}
	entries := make([]daychangesview.SourceEntry, 0, len(closures))
	for _, closure := range closures {
		roomID := ident.ID(closure.RoomID)
		entry := daychangesview.SourceEntry{
			Kind:        daychangesview.KindRoomClosed,
			Room:        &daychangesview.BlockRoom{ID: roomID, Name: closure.RoomName},
			RoomClosure: &daychangesview.DayRoomClosure{Reason: closure.Reason},
			Involved:    own[closure.RoomID],
		}
		if closure.StartDate.Before(day) {
			first := closure.StartDate
			entry.Since = &first
		}
		if closure.EndDate.After(day) {
			last := closure.EndDate
			entry.Until = &last
		}
		if s.linkRoom {
			entry.Link = &daychangesview.Link{Target: daychangesview.LinkRoom, RoomID: &roomID}
		}
		entries = append(entries, entry)
	}
	return entries, nil
}

// ownRooms names the rooms of the caller's own blocks of the day that take
// place, read only when a room is closed today: inside the request the
// day's staff rows the block sources took answer it (#7666), so the closure
// costs no statement of its own there.
func (s dayChangesRoomClosures) ownRooms(ctx context.Context, day calendar.Date, closures int) (map[int64]bool, error) {
	if closures == 0 || s.planned == nil || s.caller == nil {
		return nil, nil
	}
	staffID, isStaff, err := s.caller.CurrentStaffID(ctx)
	if err != nil {
		return nil, fmt.Errorf("resolve caller staff: %w", err)
	}
	if !isStaff {
		return nil, nil
	}
	roomIDs, err := s.planned.PlannedRoomIDs(ctx, staffID, day)
	if err != nil {
		return nil, fmt.Errorf("list own block rooms: %w", err)
	}
	own := make(map[int64]bool, len(roomIDs))
	for _, roomID := range roomIDs {
		own[roomID] = true
	}
	return own, nil
}
