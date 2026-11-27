package schoolcalendar

import (
	"context"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// OpeningChangeNotice tells the school that one of its opening changes was
// entered, changed or deleted (#8178). Previous is nil for a new change and
// Current nil for a deleted one. Push is false when no day of the change
// falls into the next 14 days: the notice then reaches the notification feed
// only. A change that only concerns past days, or that keeps days and times
// and changes the name only, is no notice at all.
type OpeningChangeNotice struct {
	OpeningChangeID int64
	Reason          string
	Previous        *OpeningChangeSpan
	Current         *OpeningChangeSpan
	Push            bool
	// Traeger marks a change the school's Träger entered for it (#8231).
	// The school reads it but cannot change it, and the feed keeps it apart
	// from the school's own changes.
	Traeger bool
}

// OpeningChangeSpan is the first and the last day of an opening change and
// its wall-clock times "HH:MM".
type OpeningChangeSpan struct {
	StartsOn calendar.Date
	EndsOn   calendar.Date
	OpensAt  string
	ClosesAt string
}

// OpeningChangeNotices is the consumer-owned port to Delivery's notification
// feed (#8178). It reaches the staff of the request's school, the families
// with access to a child of the school and the members of the school's
// Träger, without the person who made the change, and writes in the caller's
// transaction, so the notice commits or rolls back with the change.
type OpeningChangeNotices interface {
	NotifyOpeningChangeChanged(ctx context.Context, notice OpeningChangeNotice) error
}
