package daychangesview

// The room closures of the day in the overview (#8161).

import (
	"context"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// SourceRoomClosures is Räume: the rooms the school closed for the day
// (#7653, #8161). From Facilities.
const SourceRoomClosures Source = "room_closures"

// KindRoomClosed: a room of the school is closed today (#8161). Room names
// the room, RoomClosure carries the school's reason ("Wasserschaden"), never
// a person. Appointments planned there stay until the school moves them; a
// moved one is its own activity_room_changed entry.
const KindRoomClosed Kind = "room_closed"

// LinkRoom is the detail page of the room (Link.RoomID) with its closures.
const LinkRoom LinkTarget = "room"

// DayRoomClosure is today's closure of a room. Reason is the school's own
// text.
type DayRoomClosure struct {
	Reason string `json:"reason"`
}

// RoomClosures is the Räume port (#8161): the closures that cover the day,
// as the caller may see them. A caller without the rooms gets none.
type RoomClosures interface {
	RoomClosures(ctx context.Context, day calendar.Date) ([]SourceEntry, error)
}
