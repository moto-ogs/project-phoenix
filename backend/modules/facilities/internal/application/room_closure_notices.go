package application

import (
	"context"
	"fmt"

	"github.com/moto-ogs/project-phoenix/modules/facilities"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// NoticedClosures serves the room closures and tells the staff planned in
// the room of every new closure (#8234). Reads, the reopening and the
// locking reads pass to the closures unchanged.
type NoticedClosures struct {
	facilities.Closures
	notices facilities.ClosureNotices
	today   func() calendar.Date
}

var _ facilities.Closures = NoticedClosures{}

// NewNoticedClosures builds the closures over closures; today is the
// school's day the push window counts from.
func NewNoticedClosures(closures facilities.Closures, notices facilities.ClosureNotices, today func() calendar.Date) NoticedClosures {
	if closures == nil || notices == nil || today == nil {
		panic("facilities application: the closures, the notices and the day are required")
	}
	return NoticedClosures{Closures: closures, notices: notices, today: today}
}

// CloseRoom stores the closure and tells the staff planned in the room. The
// closure cannot end before today; its days from today on decide who hears.
func (c NoticedClosures) CloseRoom(ctx context.Context, input facilities.CloseRoom) (facilities.RoomClosure, error) {
	closure, err := c.Closures.CloseRoom(ctx, input)
	if err != nil {
		return closure, err
	}
	today := c.today()
	starts := closure.StartDate
	if starts.Before(today) {
		starts = today
	}
	notice := facilities.RoomClosureNotice{
		ClosureID: closure.ID, RoomID: closure.RoomID, RoomName: closure.RoomName,
		StartsOn: starts, EndsOn: closure.EndDate, Reason: closure.Reason,
		Push: !starts.After(today.AddDays(facilities.RoomClosurePushDays)),
	}
	if err := c.notices.NotifyRoomClosed(ctx, notice); err != nil {
		return facilities.RoomClosure{}, fmt.Errorf("facilities: notify room closure: %w", err)
	}
	return closure, nil
}
