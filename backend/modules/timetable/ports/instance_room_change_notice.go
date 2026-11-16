package ports

import (
	"context"
	"time"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// RoomChangePush is how far a room change may ring a phone (#7141).
type RoomChangePush int

const (
	// RoomChangePushNone writes the feed only: the block lies more than 14
	// days ahead.
	RoomChangePushNone RoomChangePush = iota
	// RoomChangePushSoon pushes a move for today or tomorrow unless the
	// person switched it off.
	RoomChangePushSoon
	// RoomChangePushLater pushes a move for a later day within 14 days only
	// for whoever switched that on.
	RoomChangePushLater
)

// InstanceRoomChangeNotice tells the staff of a block and the families of
// its children that it takes place in another room (#7141). StaffAccountIDs
// are the block's staff after the change, absent people and the person who
// made the change left out; StudentIDs the booked children. Soon is true for
// a move for today or tomorrow.
type InstanceRoomChangeNotice struct {
	InstanceID int64
	Title      string
	Date       calendar.Date
	// StartTime is the block's wall-clock start.
	StartTime       time.Time
	RoomName        string
	PreviousRoom    string
	ActorAccountID  int64
	StaffAccountIDs []int64
	StudentIDs      []int64
	Soon            bool
	Push            RoomChangePush
}

// InstanceRoomChangeNotices is the consumer-owned port to Delivery's
// notification feed. It writes in the caller's transaction, so the notice
// commits or rolls back with the edit of the block.
type InstanceRoomChangeNotices interface {
	NotifyInstanceRoomChanged(ctx context.Context, notice InstanceRoomChangeNotice) error
}
