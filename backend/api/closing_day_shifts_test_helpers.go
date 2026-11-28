//go:build testhooks

package api

import (
	"context"
	"net/http"

	"github.com/go-chi/chi/v5"

	facilitiesCompose "github.com/moto-ogs/project-phoenix/modules/facilities/compose"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess/sessiontoken"
	"github.com/moto-ogs/project-phoenix/modules/schoolcalendar"
	schoolCalendarCompose "github.com/moto-ogs/project-phoenix/modules/schoolcalendar/compose"
	timetableCompose "github.com/moto-ogs/project-phoenix/modules/timetable/compose"
	transactionruntime "github.com/moto-ogs/project-phoenix/modules/transactionruntime/compose"
	"github.com/moto-ogs/project-phoenix/modules/workforce"
	workforceCompose "github.com/moto-ogs/project-phoenix/modules/workforce/compose"
	"github.com/moto-ogs/project-phoenix/roots/owners"
	timezone "github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// ClosingDayShiftsTest is the serving root's binding of the school's closing
// days to the series shifts (#8205), over db and the day clock today:
// Calendar writes closing days with the plans bound, Planning plans series,
// and Router serves /staff-shifts, including /staff-shifts/break-day-shifts.
type ClosingDayShiftsTest struct {
	Calendar schoolcalendar.Calendar
	Planning workforce.StaffShiftPlanning
	Router   http.Handler
}

// closingDayShiftsFederalState pins the tenant's federal state: the series
// skip its statutory holidays as in production.
type closingDayShiftsFederalState struct{}

func (closingDayShiftsFederalState) ResolveString(context.Context, string) (string, error) {
	return "DE-NW", nil
}

// NewClosingDayShiftsTest composes the closing days, the Dienstplan and its
// route the way the serving root does.
func NewClosingDayShiftsTest(database transactionruntime.Database, today func() timezone.Date) (*ClosingDayShiftsTest, error) {
	records, err := newSchoolCalendarWithAdministration(database, closingDayShiftsFederalState{}, func(context.Context) error { return nil }, nil, schoolCalendarCompose.AdministrationDependencies{})
	if err != nil {
		return nil, err
	}
	timetable, err := NewTimetableTestRepositories(database)
	if err != nil {
		return nil, err
	}
	rooms, err := owners.NewTimetableRoomRows(database)
	if err != nil {
		return nil, err
	}
	shifts, err := workforceCompose.NewShiftPlanning(workforceCompose.ShiftPlanningDependencies{
		ShiftMoveAudit: owners.NewShiftMoveAudit(NewTimetableDeviationAudit(database).DeviationEvent),
		Workforce:      NewAbsenceTypeTestCapability(database), Staff: owners.NewPlanStaffDirectory(owners.MustNewMembershipTestRepositories(database).Staff), CalendarPeriods: records,
		Instances: timetableCompose.NewTimetableInstanceReads(timetable.ActivityInstance.Reads), InstanceStaff: timetableCompose.NewTimetableInstanceStaffReads(timetable.InstanceStaff),
		Rooms: facilitiesCompose.NewRoomNameDirectory(rooms.Room), ActivityGroups: timetableCompose.NewTimetableGroupReads(timetable.Timetable),
		NonWorkingDays: records, Holidays: schoolCalendarCompose.NewNonWorkingDays(records),
		DB: database.Pool(), LockStaffAssignments: ShiftPlanningTestStaffRowLock(database), Today: today,
	})
	if err != nil {
		return nil, err
	}
	calendar, err := newSchoolCalendarWithAdministration(database, closingDayShiftsFederalState{}, func(context.Context) error { return nil }, nil,
		schoolCalendarCompose.AdministrationDependencies{ClosingDayPlans: owners.NewSchoolCalendarClosingDayPlans(shifts.BreakDays)})
	if err != nil {
		return nil, err
	}
	caller, _, err := newStaffIdentityForTests(database)
	if err != nil {
		return nil, err
	}
	planning := shifts.Planning(nil)
	resource := newStaffShiftsResource(staffShiftsDependencies{
		Planning: planning, BreakDays: shifts.BreakDays,
		ResolveStaffID: currentStaffID(caller), ActorAccountID: sessiontoken.ActorAccountIDFromCtx,
	})
	router := chi.NewRouter()
	router.Mount("/staff-shifts", resource.Router())
	return &ClosingDayShiftsTest{Calendar: calendar, Planning: planning, Router: router}, nil
}
