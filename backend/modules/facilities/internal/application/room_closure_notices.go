package application

import (
	"fmt"

	"github.com/moto-ogs/project-phoenix/modules/facilities"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// NewNoticedClosures adds notices to the facilities closure service. It writes
// the closure and its durable notice in the closures' transaction; today is
// the school's day the push window counts from.
func NewNoticedClosures(closures facilities.Closures, notices facilities.ClosureNotices, today func() calendar.Date) (facilities.Closures, error) {
	if closures == nil || notices == nil || today == nil {
		panic("facilities application: the closures, notices and day are required")
	}
	roomClosures, ok := closures.(*Closures)
	if !ok {
		return nil, fmt.Errorf("facilities application: noticed closures require the facilities closure service")
	}
	return roomClosures.withNotices(notices, today), nil
}

func roomClosureNotice(closure facilities.RoomClosure, today calendar.Date) facilities.RoomClosureNotice {
	starts := closure.StartDate
	if starts.Before(today) {
		starts = today
	}
	return facilities.RoomClosureNotice{
		ClosureID: closure.ID, RoomID: closure.RoomID, RoomName: closure.RoomName,
		StartsOn: starts, EndsOn: closure.EndDate, Reason: closure.Reason,
		Push: !starts.After(today.AddDays(facilities.RoomClosurePushDays)),
	}
}
