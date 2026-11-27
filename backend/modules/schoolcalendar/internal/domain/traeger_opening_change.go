package domain

import (
	"errors"
	"time"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// ErrTraegerOpeningChangeNotFound and ErrTraegerOpeningChangeSchoolOutside
// are the refusals of the Träger opening change store (#8202).
var (
	ErrTraegerOpeningChangeNotFound      = errors.New("opening change of the Träger not found")
	ErrTraegerOpeningChangeSchoolOutside = errors.New("the school is not a school of the Träger")
)

// TraegerOpeningChange is a stored opening change of a Träger with the
// schools it applies to; OpensAt and ClosesAt are "HH:MM".
type TraegerOpeningChange struct {
	ID        int64
	StartDate calendar.Date
	EndDate   calendar.Date
	OpensAt   string
	ClosesAt  string
	Reason    string
	SchoolIDs []int64
	UpdatedAt time.Time
}

// TraegerOpeningChangeFields are the written fields of a Träger opening change.
type TraegerOpeningChangeFields struct {
	OpeningChangeFields
	SchoolIDs []int64
}
