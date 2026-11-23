//go:build testhooks

package api

import (
	"context"
	"net/http"

	"github.com/go-chi/chi/v5"

	facilitiesCompose "github.com/moto-ogs/project-phoenix/modules/facilities/compose"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess/sessiontoken"
	timetableCompose "github.com/moto-ogs/project-phoenix/modules/timetable/compose"
	transactionruntime "github.com/moto-ogs/project-phoenix/modules/transactionruntime/compose"
	"github.com/moto-ogs/project-phoenix/modules/workforce"
	workforceCompose "github.com/moto-ogs/project-phoenix/modules/workforce/compose"
	"github.com/moto-ogs/project-phoenix/roots/owners"
	timezone "github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// StaffPlanningTestRules are the Träger values of the Einsatzplanung a test
// sets (#4708); the zero value is planning on with the limits of the ArbZG.
type StaffPlanningTestRules struct {
	Off             bool
	MaxDailyMinutes int
	MinRestMinutes  int
	NoBreaks        bool
}

// StaffPlanningRules answers the Träger values as the settings would.
func (r *StaffPlanningTestRules) StaffPlanningRules(context.Context) (bool, int, int, bool, error) {
	maxDaily, minRest := 600, 660
	if r.MaxDailyMinutes > 0 {
		maxDaily = r.MaxDailyMinutes
	}
	if r.MinRestMinutes > 0 {
		minRest = r.MinRestMinutes
	}
	return !r.Off, maxDaily, minRest, !r.NoBreaks, nil
}

// StaffPlanningTestComposition composes the real Dienstplan with the
// working-time check over rules and the Änderungsprotokoll, and returns the
// school's staff-shift router and the Dienstplan the Einsatzplanung of the
// Träger plans through.
func StaffPlanningTestComposition(database transactionruntime.Database, rules *StaffPlanningTestRules) (http.Handler, workforce.TraegerShiftSites, error) {
	timetable, err := NewTimetableTestRepositories(database)
	if err != nil {
		return nil, nil, err
	}
	rooms, err := owners.NewTimetableRoomRows(database)
	if err != nil {
		return nil, nil, err
	}
	calendar, err := NewTimetableSchoolCalendar(database)
	if err != nil {
		return nil, nil, err
	}
	composition, err := workforceCompose.NewShiftPlanning(workforceCompose.ShiftPlanningDependencies{
		Workforce: NewAbsenceTypeTestCapability(database), Staff: owners.NewPlanStaffDirectory(owners.MustNewMembershipTestRepositories(database).Staff), CalendarPeriods: calendar.SchoolCalendar(),
		Instances: timetableCompose.NewTimetableInstanceReads(timetable.ActivityInstance.Reads), InstanceStaff: timetableCompose.NewTimetableInstanceStaffReads(timetable.InstanceStaff),
		Rooms: facilitiesCompose.NewRoomNameDirectory(rooms.Room), ActivityGroups: timetableCompose.NewTimetableGroupReads(timetable.Timetable), DB: database.Pool(), LockStaffAssignments: ShiftPlanningTestStaffRowLock(database),
		PlanRules: rules, WorkingTimeAudit: owners.NewWorkingTimeOverrideAudit(NewTimetableDeviationAudit(database).DeviationEvent), Today: timezone.TodayDate,
	})
	if err != nil {
		return nil, nil, err
	}
	caller, _, err := newStaffIdentityForTests(database)
	if err != nil {
		return nil, nil, err
	}
	planning := composition.Planning(nil)
	resource := newStaffShiftsResource(staffShiftsDependencies{Planning: planning, ResolveStaffID: currentStaffID(caller), ActorAccountID: sessiontoken.ActorAccountIDFromCtx})
	router := chi.NewRouter()
	router.Mount("/staff-shifts", resource.Router())
	return router, composition.TraegerSites(planning), nil
}
