package owners

import (
	"context"

	facilities "github.com/moto-ogs/project-phoenix/modules/facilities"
	timetablePorts "github.com/moto-ogs/project-phoenix/modules/timetable/ports"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// NewTimetableRoomClosures binds Timetable's consumer-owned closure port to
// Facilities without exposing Facilities' closure shape to the timetable.
func NewTimetableRoomClosures(closures facilities.Closures) timetablePorts.RoomClosures {
	return timetableRoomClosures{closures: closures}
}

type timetableRoomClosures struct{ closures facilities.Closures }

func (c timetableRoomClosures) RoomClosedOn(ctx context.Context, roomID int64, day calendar.Date) (bool, error) {
	return c.closures.RoomClosedOn(ctx, roomID, day)
}

func (c timetableRoomClosures) RoomClosureRanges(ctx context.Context, roomIDs []int64, from, until calendar.Date) ([]timetablePorts.RoomClosureRange, error) {
	closures, err := c.closures.RoomClosureRanges(ctx, roomIDs, from, until)
	if err != nil {
		return nil, err
	}
	result := make([]timetablePorts.RoomClosureRange, 0, len(closures))
	for _, closure := range closures {
		result = append(result, timetablePorts.RoomClosureRange{
			RoomID: closure.RoomID, StartDate: closure.StartDate, EndDate: closure.EndDate,
		})
	}
	return result, nil
}
