//go:build testhooks

package api

import (
	"log/slog"
	"time"

	dayChangesHTTP "github.com/moto-ogs/project-phoenix/modules/daychangesview/http"
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
	// The Kinder reads take the day as a filter; Care Plan's clock stamps
	// writes only. A shared clock adds no closure to its effect bindings.
	carePlan, err := NewClockedCarePlanForTests(db, time.Now)
	if err != nil {
		return nil, err
	}
	view, err := NewDayChanges(DayChangesSources{
		Caller: caller, Workforce: owners.MustNewWorkforce(db), Teachers: owners.NewGroupTeacherStaff(membership),
		Names: NewTimetablePeople(people), Groups: owners.NewSchoolStructureSuiteRepositories(db).Group,
		CarePlan: carePlan, Students: owners.MustNewPeopleDirectory(db),
		Today: func() calendar.Date { return today }, Logger: slog.Default(),
	})
	if err != nil {
		return nil, err
	}
	return dayChangesHTTP.NewResource(view), nil
}
