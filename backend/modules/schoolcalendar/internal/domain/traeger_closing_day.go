package domain

import (
	"errors"
	"time"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// ErrTraegerClosingDayNotFound and ErrTraegerClosingDaySchoolOutside are the
// refusals of the Träger closing day store (#4702); the application names
// them in the Träger calendar contract.
var (
	ErrTraegerClosingDayNotFound      = errors.New("closing day of the Träger not found")
	ErrTraegerClosingDaySchoolOutside = errors.New("the school is not a school of the Träger")
)

// TraegerClosingDay is a stored closing day range of a Träger with the schools
// it applies to.
type TraegerClosingDay struct {
	ID        int64
	StartDate calendar.Date
	EndDate   calendar.Date
	Reason    string
	SchoolIDs []int64
	UpdatedAt time.Time
}

// SchoolClosing is one closing day range that closes a school on a day: one
// of the school's own or one its current Träger planned for it (#7672).
type SchoolClosing struct {
	SchoolID  int64
	StartDate calendar.Date
	EndDate   calendar.Date
	Reason    string
	Traeger   bool
}

// SchoolOpening is one opening change that changes the opening hours of a
// school on a day (#8146). It carries no reason: the Träger sees the hours
// only.
type SchoolOpening struct {
	SchoolID  int64
	StartDate calendar.Date
	EndDate   calendar.Date
	OpensAt   string
	ClosesAt  string
}

// TraegerClosingDayFields are the written fields of a Träger closing day.
type TraegerClosingDayFields struct {
	StartDate calendar.Date
	EndDate   calendar.Date
	Reason    string
	SchoolIDs []int64
}
