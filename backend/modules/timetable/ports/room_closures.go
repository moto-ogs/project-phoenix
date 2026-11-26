package ports

import (
	"context"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// RoomClosureRange is the part of a Facilities closure that Timetable needs
// when it creates appointments. The consumer owns this projection so it does
// not depend on Facilities' public data shape.
type RoomClosureRange struct {
	RoomID    int64
	StartDate calendar.Date
	EndDate   calendar.Date
}

// RoomClosures serializes an appointment write with room closures and reads
// the closures of a materialization window in one batch. Facilities owns the
// data and the locking; the root binds this consumer-owned port.
type RoomClosures interface {
	RoomClosedOn(context.Context, int64, calendar.Date) (bool, error)
	RoomClosureRanges(context.Context, []int64, calendar.Date, calendar.Date) ([]RoomClosureRange, error)
}
