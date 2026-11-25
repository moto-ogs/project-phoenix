package timetable

import (
	"context"
	"errors"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// SchoolDayChanges are Timetable's facts of one day for "Heute anders" in
// moto schule (#8148): the class-wide arrival exceptions of every class
// (a changed Unterrichtsschluss) and the changed blocks a staff member is
// on (an absent or covering supervisor on one of the own Aufsichten).
// Both lists come from one statement: the route's query budget does not
// grow with the second source.
type SchoolDayChanges struct {
	Classes []ClassArrivalException
	// Blocks lists every staff row of a block, also the unchanged ones; it
	// carries no reason for an absence.
	Blocks []BlockStaffChange
}

// SchoolDayChangeQuery reads the school day changes of one day. A staffID
// of 0 reads no blocks. It applies no visibility of its own: the sources of
// the school portal's overview apply their rules (ADR 0299).
type SchoolDayChangeQuery interface {
	SchoolDayChanges(ctx context.Context, day calendar.Date, staffID int64) (SchoolDayChanges, error)
}

// ErrNoSchoolDayChanges reports a class arrival query without the read.
var ErrNoSchoolDayChanges = errors.New("timetable class arrivals: the query reads no school day changes")

// SchoolDayChangesOf is the school day read of the class arrival query the
// owner composed.
func SchoolDayChangesOf(query ClassArrivalQuery) (SchoolDayChangeQuery, error) {
	day, ok := query.(SchoolDayChangeQuery)
	if !ok {
		return nil, ErrNoSchoolDayChanges
	}
	return day, nil
}
