package application

import (
	"context"
	"fmt"

	"github.com/moto-ogs/project-phoenix/modules/facilities"
	"github.com/moto-ogs/project-phoenix/modules/facilities/internal/ports"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// NoticedClosures serves the room closures and tells the staff planned in
// the room of every new closure (#8234). Reads, the reopening and the
// locking reads pass to the closures unchanged.
type NoticedClosures struct {
	facilities.Closures
	notices     facilities.ClosureNotices
	transaction ports.Transaction
	today       func() calendar.Date
}

var _ facilities.Closures = NoticedClosures{}

// NewNoticedClosures builds the closures over closures. It writes the closure
// and its durable notice in one transaction; today is the school's day the
// push window counts from.
func NewNoticedClosures(closures facilities.Closures, notices facilities.ClosureNotices, transaction ports.Transaction, today func() calendar.Date) NoticedClosures {
	if closures == nil || notices == nil || transaction == nil || today == nil {
		panic("facilities application: the closures, notices, transaction and day are required")
	}
	return NoticedClosures{Closures: closures, notices: notices, transaction: transaction, today: today}
}

// CloseRoom stores the closure and tells the staff planned in the room. The
// closure cannot end before today; its days from today on decide who hears.
func (c NoticedClosures) CloseRoom(ctx context.Context, input facilities.CloseRoom) (facilities.RoomClosure, error) {
	var closure facilities.RoomClosure
	err := c.transaction.RunWrite(ctx, func(txCtx context.Context) error {
		var err error
		closure, err = c.Closures.CloseRoom(txCtx, input)
		if err != nil {
			return err
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
		if err := c.notices.NotifyRoomClosed(txCtx, notice); err != nil {
			return fmt.Errorf("facilities: notify room closure: %w", err)
		}
		return nil
	})
	if err != nil {
		return facilities.RoomClosure{}, err
	}
	return closure, nil
}
