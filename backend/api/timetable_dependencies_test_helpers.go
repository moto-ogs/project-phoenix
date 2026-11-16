//go:build testhooks

package api

import (
	"time"

	"fmt"

	owners "github.com/moto-ogs/project-phoenix/roots/owners"

	"github.com/moto-ogs/project-phoenix/modules/schoolcalendar"
	"github.com/moto-ogs/project-phoenix/modules/schoolstructure"
	transactionruntime "github.com/moto-ogs/project-phoenix/modules/transactionruntime/compose"
)

// The unobserved owners the retained repositories read through, one
// constructor each, for test graphs. A composition failure is a broken test
// setup and panics. Each call composes its owner afresh over db; the owners
// hold no state of their own beyond the database.

// MustNewSchoolStructure composes the School Structure owner.
func MustNewSchoolStructure(db transactionruntime.Database) schoolstructure.Capability {
	groups, err := owners.NewSchoolStructure(db)
	if err != nil {
		panic(fmt.Sprintf("compose timetable groups: %v", err))
	}
	return groups
}

// MustNewSchoolCalendar composes the School Calendar owner.
func MustNewSchoolCalendar(db transactionruntime.Database) schoolcalendar.Calendar {
	calendar, err := owners.NewSchoolCalendar(db)
	if err != nil {
		panic(fmt.Sprintf("compose timetable calendar: %v", err))
	}
	return calendar
}

// NewUnobservedTimetableRepositories builds the retained Timetable
// repositories over the unobserved owners of db.
func NewUnobservedTimetableRepositories(db transactionruntime.Database, clocks ...func() time.Time) owners.TimetableRepositories {
	return owners.NewTimetableRepositories(db, owners.MustNewUnobservedTimetable(db, clocks...), owners.MustNewPeopleDirectory(db), MustNewSchoolStructure(db),
		owners.MustNewUnobservedRooms(db), MustNewSchoolCalendar(db), owners.MustNewSchoolMembership(db), owners.MustNewWorkforce(db))
}
