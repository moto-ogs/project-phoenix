package studentpresence

import (
	"context"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// RoomClosures serializes a new room session with Facilities' room closures.
// Student Presence owns this narrow consumer port; Facilities owns its binding.
type RoomClosures interface {
	RoomClosedOn(context.Context, int64, calendar.Date) (bool, error)
}
