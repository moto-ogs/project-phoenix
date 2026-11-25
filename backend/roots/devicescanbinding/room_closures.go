package devicescanbinding

import (
	"context"

	"github.com/moto-ogs/project-phoenix/modules/devicescan"
	"github.com/moto-ogs/project-phoenix/modules/facilities"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// RoomClosures binds Device Scan's closure question to Facilities' room
// closures (#7653): one read of the room's closures on the day.
func RoomClosures(closures facilities.Closures) devicescan.RoomClosures {
	if closures == nil {
		panic("device scan binding: room closures are required")
	}
	return roomClosures{closures: closures}
}

type roomClosures struct{ closures facilities.Closures }

func (r roomClosures) RoomClosedOn(ctx context.Context, roomID int64, day calendar.Date) (bool, error) {
	found, err := r.closures.ListRoomClosures(ctx, facilities.RoomClosureFilter{RoomID: &roomID, From: day, Until: day})
	if err != nil {
		return false, err
	}
	return len(found) > 0, nil
}
