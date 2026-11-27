package facilities

import (
	"context"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// RoomClosurePushDays bounds how far ahead a closure may ring a phone
// (#8234), like the closing days (#7144): a closure that begins within the
// next 14 days pushes, a later one reaches the notification feed only.
const RoomClosurePushDays = 14

// RoomClosureNotice tells the staff planned in a room that the school closed
// it (#8234). StartsOn is the first day of the closure that has not passed,
// so the notice reaches only the people planned there from today on. Reason
// is the school's own text about the room ("Wasserschaden"); the notice names
// no person.
type RoomClosureNotice struct {
	ClosureID int64
	RoomID    int64
	RoomName  string
	StartsOn  calendar.Date
	EndsOn    calendar.Date
	Reason    string
	// Push is false when the closure begins beyond RoomClosurePushDays.
	Push bool
}

// ClosureNotices is the consumer-owned port to Delivery's notification feed
// (#8234). It reaches the staff planned on a block in the room within the
// notice's days, without the person who closed it, and writes in the
// caller's transaction, so the notice commits or rolls back with the closure.
type ClosureNotices interface {
	NotifyRoomClosed(ctx context.Context, notice RoomClosureNotice) error
}
