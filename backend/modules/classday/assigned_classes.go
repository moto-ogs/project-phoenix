package classday

import (
	"context"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// AssignedClassesReport is the school portal's aggregate report. It has no
// child rows or identifiers; the class sheet is a separate, audited read.
type AssignedClassesReport struct {
	Date            calendar.Date  `json:"date"`
	Weekday         string         `json:"weekday"`
	SchoolDay       bool           `json:"school_day"`
	EnrollmentKnown bool           `json:"enrollment_known"`
	Classes         []ClassSummary `json:"classes"`
}

type ClassSummary struct {
	SchoolClass string    `json:"school_class"`
	Totals      DayTotals `json:"totals"`
	Changes     int       `json:"changes"`
	// Trips are the children of the class on a trip today (#8155), one
	// entry per return time: a Klassenfahrt (status day) without one, a day
	// outing with the time the children come to the OGS. Never a child or a
	// reason; empty on a day without a trip.
	Trips []ClassTripSummary `json:"trips"`
}

// ClassTripSummary is the number of children of a class on a trip with one
// return time ("15:04"), nil for a trip over the whole day.
type ClassTripSummary struct {
	ReturnTime *string `json:"return_time"`
	Children   int     `json:"children"`
}

type AssignedClasses interface {
	AssignedClassesReport(ctx context.Context, date calendar.Date) (*AssignedClassesReport, error)
}

type (
	// AssignedRoster is the set of facts used for class totals, not a class
	// sheet. Roster membership is resolved by Enrollment.
	AssignedRoster struct {
		EnrollmentKnown bool
		Students        []AssignedRosterStudent
		ListEntries     map[string]int
	}
	AssignedRosterStudent struct {
		StudentID        int64
		SchoolClass      string
		WithoutCarePlace bool
		HasOffering      bool
	}
)
