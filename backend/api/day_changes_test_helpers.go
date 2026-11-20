//go:build testhooks

package api

import (
	"log/slog"

	dayChangesHTTP "github.com/moto-ogs/project-phoenix/modules/daychangesview/http"
	timetableCompose "github.com/moto-ogs/project-phoenix/modules/timetable/compose"
	transactionruntime "github.com/moto-ogs/project-phoenix/modules/transactionruntime/compose"
	"github.com/moto-ogs/project-phoenix/roots/owners"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/tenant"
)

// NewDayChangesTestResource binds "Heute anders" (#7659) over the same
// owners as production, with the day pinned to today.
func NewDayChangesTestResource(db transactionruntime.Database, unit tenant.UnitOfWork, today calendar.Date) (*dayChangesHTTP.Resource, error) {
	caller, err := NewUserContextTestModule(db, unit)
	if err != nil {
		return nil, err
	}
	membership, err := owners.NewSchoolMembership(db)
	if err != nil {
		return nil, err
	}
	people, err := NewRFIDTestPeople(db)
	if err != nil {
		return nil, err
	}
	// The operational day of the active graph; its read takes the day.
	day, _ := NewActiveTestTimetable(db, unit)
	blocks, err := timetableCompose.BlockDayChanges(day.TimetableOperations)
	if err != nil {
		return nil, err
	}
	view, err := NewDayChanges(DayChangesSources{
		Caller: caller, Workforce: owners.MustNewWorkforce(db), Teachers: owners.NewGroupTeacherStaff(membership),
		Names: NewTimetablePeople(people), Groups: owners.NewSchoolStructureSuiteRepositories(db).Group,
		Blocks: blocks,
		Today:  func() calendar.Date { return today }, Logger: slog.Default(),
	})
	if err != nil {
		return nil, err
	}
	return dayChangesHTTP.NewResource(view), nil
}
