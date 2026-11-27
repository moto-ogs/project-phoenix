package traegercalendar

import (
	"context"
	"errors"

	"github.com/moto-ogs/project-phoenix/modules/schoolcalendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

// Opening changes of a Träger (#8202). The Träger-Büro plans other opening
// hours on single days, such as a shorter day before the holidays, for some
// or all of its schools. The rows belong to the Träger and are written in its
// Träger transaction (ADR 0105); each named school reads them beside its own
// opening changes while it belongs to the Träger (ADR 0194) and cannot change
// them. The earliest closing time of a day replaces
// operations.session_end_time there, as a school's own change does.

var (
	// ErrOpeningChangeNotFound reports an opening change that does not
	// exist for the Träger of the session.
	ErrOpeningChangeNotFound = errors.New("opening change of the Träger not found")
	// ErrInvalidOpeningChange reports an opening change without dates,
	// times, name or school, or with its end before its start or its
	// closing time not after its opening time.
	ErrInvalidOpeningChange = errors.New("invalid opening change of the Träger")
)

// InvalidOpeningChangeError names the field an opening change fails on; it
// unwraps to ErrInvalidOpeningChange.
type InvalidOpeningChangeError struct {
	Field  string
	Reason string
}

func (e *InvalidOpeningChangeError) Error() string { return e.Reason }
func (e *InvalidOpeningChangeError) Unwrap() error { return ErrInvalidOpeningChange }

// OpeningChange is one range of days with other opening hours at the named
// schools. OpensAt and ClosesAt are wall-clock times "HH:MM".
type OpeningChange struct {
	ID        ident.ID      `json:"id"`
	StartDate calendar.Date `json:"start_date"`
	EndDate   calendar.Date `json:"end_date"`
	OpensAt   string        `json:"opens_at"`
	ClosesAt  string        `json:"closes_at"`
	Reason    string        `json:"reason"`
	SchoolIDs []ident.ID    `json:"school_ids"`
	// Version is the token a change sends back as expected_version (ADR 0311).
	Version string `json:"version"`
	// AffectedSchoolIDs names every school whose opening hours changed through
	// this write. It includes schools removed from an updated change and is not
	// part of the HTTP response.
	AffectedSchoolIDs []int64 `json:"-"`
}

// OpeningChangeInput is an opening change as the Träger-Büro writes it.
// ExpectedVersion is the Version it read; an update of a change written
// since is refused with readstate.ErrChanged. A create ignores it.
type OpeningChangeInput struct {
	StartDate       calendar.Date
	EndDate         calendar.Date
	OpensAt         string
	ClosesAt        string
	Reason          string
	SchoolIDs       []int64
	ExpectedVersion string
}

// OpeningChanges maintains the opening changes of a Träger. The caller runs
// every operation in the Träger transaction of organizationID.
type OpeningChanges interface {
	// ListOpeningChanges lists the Träger's changes touching [from, to], by start.
	ListOpeningChanges(ctx context.Context, organizationID int64, from, to calendar.Date) ([]OpeningChange, error)
	CreateOpeningChange(ctx context.Context, organizationID int64, input OpeningChangeInput) (OpeningChange, error)
	UpdateOpeningChange(ctx context.Context, organizationID, id int64, input OpeningChangeInput) (OpeningChange, error)
	// DeleteOpeningChange removes a change and returns its schools so their
	// current views can refresh after the surrounding transaction commits.
	DeleteOpeningChange(ctx context.Context, organizationID, id int64) (OpeningChange, error)
}

// OpeningChangeNotices is the consumer-owned port to Delivery's notification
// feed for the opening changes of a Träger (#8231). NotifySchool tells one
// named school of the change, with the same type, audience and push window
// as a change the school entered itself (#8178), in a school transaction of
// that school: its own switch notifications.opening_change_enabled decides,
// and the person who made the change is left out.
type OpeningChangeNotices interface {
	NotifySchool(ctx context.Context, schoolID int64, notice schoolcalendar.OpeningChangeNotice) error
}
