package schoolcalendar

import (
	"context"
	"errors"
	"time"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/readstate"
)

// Changed opening hours of a school (#7654). The regular opening hours are
// the settings opening_hours.* per school day; an opening change replaces
// them from StartDate to EndDate, for example a shorter day before the
// holidays. The school maintains it beside its closing days, with the same
// rights. Reason is the name the school gives the day, not a reason of a
// person.

// OpeningChangeReasonMaxLength caps the name of an opening change.
const OpeningChangeReasonMaxLength = 255

var (
	// ErrOpeningChangeNotFound reports an opening change that does not exist
	// in the school of the transaction.
	ErrOpeningChangeNotFound = errors.New("opening change not found")
	// ErrInvalidOpeningChange reports an opening change without dates, times
	// or name, with its end before its start or its closing time not after
	// its opening time.
	ErrInvalidOpeningChange = errors.New("invalid opening change")
)

// InvalidOpeningChangeError names the field an opening change fails on; it
// unwraps to ErrInvalidOpeningChange.
type InvalidOpeningChangeError struct {
	Field  string
	Reason string
}

func (e *InvalidOpeningChangeError) Error() string { return e.Reason }
func (e *InvalidOpeningChangeError) Unwrap() error { return ErrInvalidOpeningChange }

// OpeningChange is one range of days with other opening hours. OpensAt and
// ClosesAt are wall-clock times "HH:MM" of the school's day.
type OpeningChange struct {
	ID        int64
	StartDate calendar.Date
	EndDate   calendar.Date
	OpensAt   string
	ClosesAt  string
	Reason    string
	UpdatedAt time.Time
}

// Version is the token a change sends back as expected version (ADR 0311).
func (c OpeningChange) Version() string { return readstate.Of(c.UpdatedAt) }

// OpeningChangeInput is an opening change as the school writes it.
// ExpectedVersion is the Version the school read; an update of a change
// written since is refused with readstate.ErrChanged. A create ignores it.
type OpeningChangeInput struct {
	StartDate       calendar.Date
	EndDate         calendar.Date
	OpensAt         string
	ClosesAt        string
	Reason          string
	ExpectedVersion string
}

// OpeningChanges maintains the opening changes of the school of the ambient
// tenant transaction; every operation runs in that transaction.
type OpeningChanges interface {
	// ListOpeningChanges lists the changes touching [from, to], by start.
	ListOpeningChanges(ctx context.Context, from, to calendar.Date) ([]OpeningChange, error)
	CreateOpeningChange(ctx context.Context, input OpeningChangeInput) (OpeningChange, error)
	UpdateOpeningChange(ctx context.Context, id int64, input OpeningChangeInput) (OpeningChange, error)
	DeleteOpeningChange(ctx context.Context, id int64) error
}
