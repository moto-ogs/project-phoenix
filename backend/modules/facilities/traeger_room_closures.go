package facilities

import (
	"context"
	"errors"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// TraegerRoomClosures counts the rooms a closure closes on a day, per school,
// for "Heute anders" in the Träger-Portal (#8146). The count names no room
// and no reason.
//
// The caller runs it in the administrative transaction of the Träger
// projection; it reads only the given schools. The map holds only schools
// with a closed room.
type TraegerRoomClosures interface {
	ClosedRoomsByTenant(ctx context.Context, schools []int64, day calendar.Date) (map[int64]int, error)
}

// ErrNoTraegerRoomClosures reports Träger rooms without the count.
var ErrNoTraegerRoomClosures = errors.New("facilities: the Träger rooms count no closed rooms")

// TraegerRoomClosuresOf is the count of the closed rooms the Träger rooms
// composed; both read on the caller's administrative transaction.
func TraegerRoomClosuresOf(rooms TraegerRooms) (TraegerRoomClosures, error) {
	closures, ok := rooms.(TraegerRoomClosures)
	if !ok {
		return nil, ErrNoTraegerRoomClosures
	}
	return closures, nil
}
