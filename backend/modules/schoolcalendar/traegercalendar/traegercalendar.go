// Package traegercalendar is School Calendar's contract for the closing days
// of a Träger (#4702) and the Träger's view of its schools' calendars.
package traegercalendar

import (
	"context"
	"errors"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/schoolcalendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

// Closing days of a Träger (#4702). The Träger-Büro plans a closing day,
// such as a bridge day or a staff outing, for some or all of its schools.
// The rows belong to the Träger and are written in its Träger transaction
// (ADR 0105); each named school reads them as its own closing days, so they
// act like a closing day the school entered itself: no Soll, no Regeltermin,
// marked in the Dienstplan and the calendars, and no bookable holiday care.
// The statutory holidays still come from each school's federal state
// (operations.federal_state), which only the moto team sets; the Träger sees
// it here and cannot change it.

var (
	// ErrClosingDayNotFound reports a closing day that does not exist
	// for the Träger of the session.
	ErrClosingDayNotFound = errors.New("closing day of the Träger not found")
	// ErrSchoolOutside reports a named school that is not
	// an undeleted school of the Träger.
	ErrSchoolOutside = errors.New("the school is not a school of the Träger")
	// ErrInvalidClosingDay reports a closing day without dates,
	// reason or schools, or with its end before its start.
	ErrInvalidClosingDay = errors.New("invalid closing day of the Träger")
	// ErrHolidayBookingsChanged reports a save whose affected holiday
	// bookings are no longer those of the preview the Büro confirmed
	// (#6434); nothing is saved.
	ErrHolidayBookingsChanged = errors.New("the holiday bookings of the closing day changed since the preview")
)

// ClosingDay is one closing day range of a Träger with the schools it
// applies to. A single day has StartDate == EndDate.
type ClosingDay struct {
	ID        ident.ID      `json:"id"`
	StartDate calendar.Date `json:"start_date"`
	EndDate   calendar.Date `json:"end_date"`
	Reason    string        `json:"reason"`
	SchoolIDs []ident.ID    `json:"school_ids"`
	UpdatedAt time.Time     `json:"updated_at"`
	// Version is the token a change sends back as expected_version (ADR
	// 0311).
	Version string `json:"version"`
	// NotifiedFamilies counts the families a save told about the closing
	// day in their booked holiday weeks (#6434); zero on a read.
	NotifiedFamilies int `json:"notified_families"`
	// AffectedSchoolIDs names every school whose calendar changed through this
	// write. It includes schools removed from an updated closing day and is not
	// part of the HTTP response.
	AffectedSchoolIDs []int64 `json:"-"`
}

// ClosingDayInput is a closing day as the Träger-Büro writes it.
// HolidayBookingsToken is the token of the preview of the holiday bookings
// it affects that the Büro confirmed (#6434), empty when it saw none.
// ExpectedVersion is the Version of the closing day a change replaces, as
// the Büro read it (ADR 0311); a closing day changed since, and an empty
// version, is refused with readstate.ErrChanged. A new closing day has none.
//
// For the holiday notices the Owner adds ClosingDayID, the saved closing
// day a change or a deletion replaces, Previous, its stored version whose
// days may open again (#6457), and Deleted for a deletion.
type ClosingDayInput struct {
	StartDate            calendar.Date
	EndDate              calendar.Date
	Reason               string
	SchoolIDs            []int64
	HolidayBookingsToken string
	ExpectedVersion      string
	ClosingDayID         int64
	Previous             *ClosingDaySpan
	Deleted              bool
}

// ClosingDaySpan is the stored version of a closing day: its schools and
// days.
type ClosingDaySpan struct {
	StartDate calendar.Date
	EndDate   calendar.Date
	SchoolIDs []int64
}

// CalendarSchool is a school of the Träger with the federal state its
// statutory holidays come from.
type CalendarSchool struct {
	ID           ident.ID                     `json:"id"`
	Name         string                       `json:"name"`
	FederalState schoolcalendar.HolidayRegion `json:"federal_state"`
}

// Holidays are the statutory holidays of one federal state in the
// window of a calendar overview.
type Holidays struct {
	Region   schoolcalendar.HolidayRegion `json:"region"`
	Holidays []schoolcalendar.Holiday     `json:"holidays"`
}

// Calendar is what the Träger-Büro sees of its schools' calendars in
// a window: its closing days, its schools with their federal state, and the
// statutory holidays of each state.
type Calendar struct {
	ClosingDays []ClosingDay     `json:"closing_days"`
	Schools     []CalendarSchool `json:"schools"`
	Holidays    []Holidays       `json:"holidays"`
}

// ClosingDays lets the Träger-Büro plan closing days. Every operation
// names the Träger of the session and runs in its Träger transaction, which
// the caller opens.
type ClosingDays interface {
	Calendar(ctx context.Context, organizationID int64, from, to calendar.Date) (Calendar, error)
	CreateClosingDay(ctx context.Context, organizationID int64, input ClosingDayInput) (ClosingDay, error)
	UpdateClosingDay(ctx context.Context, organizationID, closingDayID int64, input ClosingDayInput) (ClosingDay, error)
	// DeleteClosingDay removes a closing day and tells the parents of the
	// holiday bookings whose days open again; holidayBookingsToken confirms
	// that preview (#6457). It returns the deleted day and the families told.
	DeleteClosingDay(ctx context.Context, organizationID, closingDayID int64, holidayBookingsToken string) (ClosingDay, error)
}

// SchoolState is a school of a Träger with its federal-state ISO code, as
// the root reads it from Organisation & Tenancy and the settings.
type SchoolState struct {
	ID           int64
	Name         string
	FederalState string
}

// Schools is School Calendar's port onto the undeleted schools of a
// Träger and their federal state (operations.federal_state). The root binds
// it; the read runs outside the Träger transaction, whose row security hides
// the schools' settings.
type Schools interface {
	TraegerSchools(ctx context.Context, organizationID int64) ([]SchoolState, error)
}

// HolidayNotices is School Calendar's port onto the parents of the holiday
// bookings a closing day takes care from (#6434). The root binds it to
// Enrollment. NotifyHolidayBookings runs in the caller's Träger transaction
// after the closing day is written: it tells each affected family once,
// returns how many it told and refuses with ErrHolidayBookingsChanged when
// the bookings differ from the confirmed preview, so the save rolls back.
type HolidayNotices interface {
	NotifyHolidayBookings(ctx context.Context, organizationID int64, day ClosingDayInput) (int, error)
}

// SchoolClosing is a closing day that closes a school of the Träger on the
// day "Heute anders" reads (#7672): one the school entered or one the Träger
// planned for it. Reason is the name the school or the Träger gave it, not a
// reason of a person.
type SchoolClosing struct {
	StartDate calendar.Date
	EndDate   calendar.Date
	Reason    string
	Traeger   bool
}

// SchoolClosings reads the closing days of the Träger's schools on one day,
// keyed by school; a school without one is missing. A Träger closing day
// counts only for the schools it names that belong to organizationID now
// (ADR 0194). The caller runs it in the administrative transaction of the
// Träger projection and passes the Träger's schools; it reads no other.
type SchoolClosings interface {
	SchoolClosingsOn(ctx context.Context, organizationID int64, schools []int64, day calendar.Date) (map[int64][]SchoolClosing, error)
}

// ErrNoSchoolClosings reports Träger closing days without the read.
var ErrNoSchoolClosings = errors.New("school calendar: the Träger closing days read no school closings")

// SchoolClosingsOf is the read of the schools' closing days the Träger
// closing days composed; they read their own rows.
func SchoolClosingsOf(days ClosingDays) (SchoolClosings, error) {
	closings, ok := days.(SchoolClosings)
	if !ok {
		return nil, ErrNoSchoolClosings
	}
	return closings, nil
}
