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

// dayChangesRoomClosures is the Räume source; linkRoom leads to the room's
// page of the staff portal.
type dayChangesRoomClosures struct {
	reads    dayChangesRoomClosureReads
	linkRoom bool
}

func (s dayChangesRoomClosures) RoomClosures(ctx context.Context, day calendar.Date) ([]daychangesview.SourceEntry, error) {
	granted := sessiontoken.PermissionsFromCtx(ctx)
	if !securityruntime.HasAdminWildcard(granted) && !securityruntime.HasPermission(permissions.RoomsRead, granted) {
		// The account reads no rooms: no entries, not a failure.
		return nil, nil
	}
	closures, err := s.reads.ListRoomClosures(ctx, facilities.RoomClosureFilter{From: day, Until: day})
	if err != nil {
		return nil, fmt.Errorf("list room closures: %w", err)
	}
	entries := make([]daychangesview.SourceEntry, 0, len(closures))
	for _, closure := range closures {
		roomID := ident.ID(closure.RoomID)
		entry := daychangesview.SourceEntry{
			Kind:        daychangesview.KindRoomClosed,
			Room:        &daychangesview.BlockRoom{ID: roomID, Name: closure.RoomName},
			RoomClosure: &daychangesview.DayRoomClosure{Reason: closure.Reason},
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
