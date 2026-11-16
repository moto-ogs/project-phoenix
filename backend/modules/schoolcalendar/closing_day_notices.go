package schoolcalendar

import (
	"context"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// ClosingDayNotice tells the school that one of its closing days was planned,
// changed or cancelled (#7144). Previous is nil for a new closing day and
// Current nil for a cancelled one. Push is false when no day of the change
// falls into the next 14 days: the notice then reaches the notification feed
// only. A change that only concerns past days, or that keeps the days and
// changes the reason only, is no notice at all.
type ClosingDayNotice struct {
	ClosingDayID int64
	Reason       string
	Previous     *ClosingDayRange
	Current      *ClosingDayRange
	Push         bool
}

// ClosingDayRange is the first and the last day of a closing day.
type ClosingDayRange struct {
	StartsOn calendar.Date
	EndsOn   calendar.Date
}

// ClosingDayNotices is the consumer-owned port to Delivery's notification
// feed (#7144). It reaches every account of the request's school and the
// families with access to a child of the school, without the person who made
// the change, and writes in the caller's transaction, so the notice commits
// or rolls back with the closing day.
type ClosingDayNotices interface {
	NotifyClosingDayChanged(ctx context.Context, notice ClosingDayNotice) error
}
