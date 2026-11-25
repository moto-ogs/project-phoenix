package facilities

import (
	"context"
	"errors"
	"time"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// RoomClosureReasonMaxLength bounds the reason of a closure in characters.
const RoomClosureReasonMaxLength = 200

// RoomClosureMaxDays bounds one closure to a school year; a room closed for
// longer is removed or archived instead.
const RoomClosureMaxDays = 366

var (
	// ErrInvalidRoomClosure rejects a closure without reason, with an end
	// before its start, one that ended before today or one longer than
	// RoomClosureMaxDays.
	ErrInvalidRoomClosure = errors.New("invalid room closure")
	// ErrRoomClosureNotFound reports a closure the school does not have for
	// the room.
	ErrRoomClosureNotFound = errors.New("room closure not found")
)

// RoomClosure closes one room for a day or a period, both days included,
// with its reason (#7653), e.g. a water damage. A closed room cannot be
// chosen for new appointments or at the kiosk; appointments already planned
// there stay where they are until the school moves them.
type RoomClosure struct {
	ID        int64
	RoomID    int64
	StartDate calendar.Date
	EndDate   calendar.Date
	Reason    string
	CreatedAt time.Time
}

// Covers reports whether the closure holds on the day.
func (c RoomClosure) Covers(day calendar.Date) bool {
	return !day.Before(c.StartDate) && !day.After(c.EndDate)
}

// CloseRoom is the input of a closure.
type CloseRoom struct {
	RoomID    int64
	StartDate calendar.Date
	EndDate   calendar.Date
	Reason    string
}

// RoomClosureFilter selects the closures that overlap From through Until,
// both included; RoomID narrows them to one room.
type RoomClosureFilter struct {
	RoomID *int64
	From   calendar.Date
	Until  calendar.Date
}

// Closures owns the room closures of the caller's school. ReopenRoom lifts a
// closure: it deletes it, so the room is open again on every day it covered.
type Closures interface {
	CloseRoom(context.Context, CloseRoom) (RoomClosure, error)
	ReopenRoom(ctx context.Context, roomID, closureID int64) error
	ListRoomClosures(context.Context, RoomClosureFilter) ([]RoomClosure, error)
}

// ClosedRoomsOn maps each room closed on the day to the closure that closes
// it; with several, the one ending last.
func ClosedRoomsOn(closures []RoomClosure, day calendar.Date) map[int64]RoomClosure {
	closed := make(map[int64]RoomClosure)
	for _, closure := range closures {
		if !closure.Covers(day) {
			continue
		}
		if current, ok := closed[closure.RoomID]; !ok || closure.EndDate.After(current.EndDate) {
			closed[closure.RoomID] = closure
		}
	}
	return closed
}
