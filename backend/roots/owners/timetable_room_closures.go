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
	return timetableRoomClosures{Closures: closures}
}

// Embedding preserves Facilities' scalar verdict while the batch operation
// below translates Facilities' rows into Timetable's consumer projection.
type timetableRoomClosures struct{ facilities.Closures }

func (c timetableRoomClosures) RoomClosureRanges(ctx context.Context, roomIDs []int64, from, until calendar.Date) ([]timetablePorts.RoomClosureRange, error) {
	return timetableRoomClosureRanges(c.Closures, ctx, roomIDs, from, until)
}

func timetableRoomClosureRanges(closures facilities.Closures, ctx context.Context, roomIDs []int64, from, until calendar.Date) ([]timetablePorts.RoomClosureRange, error) {
	values, err := closures.RoomClosureRanges(ctx, roomIDs, from, until)
	if err != nil {
		return nil, err
	}
	result := make([]timetablePorts.RoomClosureRange, 0, len(values))
	for _, closure := range values {
		result = append(result, timetablePorts.RoomClosureRange{
			RoomID: closure.RoomID, StartDate: closure.StartDate, EndDate: closure.EndDate,
		})
	}
	return result, nil
}
