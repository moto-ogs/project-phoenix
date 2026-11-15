//go:build testhooks

package owners

import (
	"fmt"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/facilities"
	facilitiesCompose "github.com/moto-ogs/project-phoenix/modules/facilities/compose"
	"github.com/moto-ogs/project-phoenix/modules/schoolmembership"
	"github.com/moto-ogs/project-phoenix/modules/timetable"
	transactionruntime "github.com/moto-ogs/project-phoenix/modules/transactionruntime/compose"
	workforceCompose "github.com/moto-ogs/project-phoenix/modules/workforce/compose"
)

// MustNewUnobservedTimetable composes the unobserved Timetable owner over
// the People Directory and Facilities owners of db, deciding on the Berlin
// day of the first clock (the real one when none is given).
func MustNewUnobservedTimetable(db transactionruntime.Database, clocks ...func() time.Time) timetable.Capability {
	capability, err := NewUnobservedTimetable(db, MustNewPeopleDirectory(db), MustNewUnobservedRooms(db), clocks...)
	if err != nil {
		panic(fmt.Sprintf("compose timetable: %v", err))
	}
	return capability
}

// MustNewUnobservedRooms composes the unobserved Facilities owner.
func MustNewUnobservedRooms(db transactionruntime.Database) facilities.Capability {
	rooms, err := facilitiesCompose.NewUnobserved(db.Pool())
	if err != nil {
		panic(fmt.Sprintf("compose timetable rooms: %v", err))
	}
	return rooms
}

// MustNewSchoolMembership composes the School Membership owner.
func MustNewSchoolMembership(db transactionruntime.Database) schoolmembership.Capability {
	membership, err := NewSchoolMembership(db)
	if err != nil {
		panic(fmt.Sprintf("compose timetable membership: %v", err))
	}
	return membership
}

// MustNewWorkforce composes the unobserved Workforce owner over the School
// Membership owner of db.
func MustNewWorkforce(db transactionruntime.Database) workforceCompose.WorkTime {
	workTime, err := NewWorkforce(db, MustNewSchoolMembership(db))
	if err != nil {
		panic(fmt.Sprintf("compose workforce work-time: %v", err))
	}
	return workTime
}
