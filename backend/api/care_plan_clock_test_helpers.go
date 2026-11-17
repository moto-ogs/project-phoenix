//go:build testhooks

package api

import (
	"time"

	"github.com/moto-ogs/project-phoenix/modules/careplan"
	facilitiesCompose "github.com/moto-ogs/project-phoenix/modules/facilities/compose"
	peopleCompose "github.com/moto-ogs/project-phoenix/modules/peopledirectory/compose"
	timetablePorts "github.com/moto-ogs/project-phoenix/modules/timetable/ports"
	transactionruntime "github.com/moto-ogs/project-phoenix/modules/transactionruntime/compose"
	owners "github.com/moto-ogs/project-phoenix/roots/owners"
)

// NewClockedCarePlanForTests composes Care Plan as the root does, on the
// clock a test pins.
func NewClockedCarePlanForTests(db transactionruntime.Database, now func() time.Time) (careplan.Capability, error) {
	persons := peopleCompose.MustNewReads(db.Pool(), owners.StudentDirectoryReader())
	rooms, err := facilitiesCompose.NewUnobserved(db.Pool())
	if err != nil {
		return nil, err
	}
	plans, err := owners.NewUnobservedTimetable(db, persons, rooms)
	if err != nil {
		return nil, err
	}
	slots := owners.CarePlanStatusSlots(timetablePorts.ParticipantRows{Plans: plans, Presence: owners.NewUnloggedStudentPresence(db), Reads: owners.MustPresenceReads(db)})
	return owners.ComposeCarePlan(db, persons, slots, now)
}
