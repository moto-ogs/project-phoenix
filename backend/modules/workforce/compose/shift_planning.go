package compose

import (
	"context"
	"errors"
	"log/slog"

	"github.com/moto-ogs/project-phoenix/modules/planexport"
	"github.com/moto-ogs/project-phoenix/modules/workforce"
	"github.com/moto-ogs/project-phoenix/modules/workforce/internal/adapters/postgres"
	"github.com/moto-ogs/project-phoenix/modules/workforce/internal/planning"
	"github.com/moto-ogs/project-phoenix/realtime"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/uptrace/bun"
)

// The readers the Dienstplan side of Workforce needs from other owners. They
// are declared here, at the composition seam, so the planning application
// layer never names a foreign repository contract (#3418).

// StaffOverviewReader is the roster read the week grid needs: every staff
// member of the tenant, plus the named ones an assignment refers to.
type StaffOverviewReader interface {
	ListMembershipsWithPerson(ctx context.Context) ([]*workforce.PlanStaff, error)
	ListAllWithPerson(ctx context.Context) ([]*workforce.PlanStaff, error)
	FindWithPersonByIDs(ctx context.Context, ids []int64) (map[int64]*workforce.PlanStaff, error)
}

// StaffDirectory adds the single lookup a shift write needs, to reject a
// shift for a staff member the tenant does not have. FindByID takes an
// untyped id because the bound repository is the generic one.
type StaffDirectory interface {
	StaffOverviewReader
	FindByID(ctx context.Context, id any) (*workforce.PlanStaff, error)
}

// CalendarPeriodLookup resolves the School Calendar period a series
// materializes over; the School Calendar capability satisfies it.
type CalendarPeriodLookup = planning.CalendarPeriodLookup

// ActivityInstanceReader loads the timetable blocks the week grid and the
// self-service assignments are built from, in the Timetable owner's
// scheduled-instance vocabulary (the plan with its session state).
type ActivityInstanceReader interface {
	planning.ActivityInstanceRangeReader
	planning.ActivityInstanceBatchReader
}

// InstanceStaffReader loads who is planned into those blocks.
type InstanceStaffReader interface {
	planning.InstanceStaffBatchReader
	planning.AssignmentInstanceStaffReader
}

// RoomReader names the "Ort" of an assignment.
type RoomReader = planning.RoomBatchReader

// ActivityGroupReader resolves the Angebot an assignment belongs to.
type ActivityGroupReader = planning.ActivityGroupBatchReader

// StaffWorkScheduleReader and WorkTimeModelReader feed the contractual
// weekly target of the week grid's summaries; the Workforce capability
// serves both.
type (
	StaffWorkScheduleReader = planning.StaffWorkScheduleBatchReader
	WorkTimeModelReader     = planning.WorkTimeModelBatchReader
)

// ShiftPlanningDependencies wires the Dienstplan side of Workforce.
type ShiftPlanningDependencies struct {
	// Workforce serves the native shift, series, exception, shift-type and sick-report rows.
	Workforce planning.Records
	Staff     StaffDirectory
	// CalendarPeriods resolves the period a series materializes over.
	CalendarPeriods CalendarPeriodLookup
	// ShiftMoveAudit appends the shift_moved Änderungsprotokoll row (#1884).
	ShiftMoveAudit func(context.Context, workforce.ShiftMovedEvent) error
	Instances      ActivityInstanceReader
	InstanceStaff  InstanceStaffReader
	Rooms          RoomReader
	ActivityGroups ActivityGroupReader
	// WorkSchedules, WorkModels and Holidays refine the week grid's weekly
	// targets; all three are optional.
	WorkSchedules StaffWorkScheduleReader
	WorkModels    WorkTimeModelReader
	Holidays      planning.HolidayDatesReader
	// NonWorkingDays lets series skip statutory holidays, Ferien and closing
	// days (#3820), bound to the School Calendar. Optional: nil plans every
	// occurrence.
	NonWorkingDays planning.SeriesCalendarReads
	// CategoryLinker syncs the optional Kategorie-Schichtart mapping, whose FK
	// lives with the Timetable owner. Optional: nil leaves mappings untouched.
	CategoryLinker planning.CategoryLinker
	// DB carries the per-staff advisory lock that makes the overlap check safe
	// under concurrency.
	DB                   *bun.DB
	LockStaffAssignments func(ctx context.Context, staffIDs []int64) error // staff rows, ascending, one batch (#7683)
	// Broadcaster and Logger are optional.
	Broadcaster realtime.Broadcaster
	Logger      *slog.Logger
	// Today is the calendar-day clock the materializer and the sick state of
	// shift writes compare against; required.
	Today func() calendar.Date
	// PlanRules (nil: ArbZG defaults) and WorkingTimeAudit feed the working-time check (ADR 0242).
	PlanRules        planning.PlanRuleSettings
	WorkingTimeAudit func(context.Context, workforce.ShiftWorkingTimeOverride) error
}

// ShiftPlanning is the composed Dienstplan side of Workforce: the public
// contracts the routes and the plan export consume.
type ShiftPlanning struct {
	ShiftTypes  workforce.ShiftTypeAdministration
	Assignments workforce.StaffAssignmentQuery
	Overview    workforce.StaffScheduleOverviewQuery

	shifts   planning.StaffShiftService
	series   planning.StaffShiftSeriesService
	overview planning.StaffScheduleOverviewGetter
}

// NewShiftPlanning composes the shift, series, shift-type, assignment and
// week-grid services over the Workforce capability rows.
func NewShiftPlanning(deps ShiftPlanningDependencies) (*ShiftPlanning, error) {
	switch {
	case deps.Workforce == nil || deps.Today == nil:
		return nil, errors.New("shift planning: the Workforce capability and the school day clock are required")
	case deps.ShiftMoveAudit == nil:
		return nil, errors.New("shift planning: the shift move audit is required")
	case deps.Staff == nil:
		return nil, errors.New("shift planning: the staff directory is required")
	case deps.CalendarPeriods == nil:
		return nil, errors.New("shift planning: the calendar period lookup is required")
	case deps.Instances == nil || deps.InstanceStaff == nil || deps.Rooms == nil || deps.ActivityGroups == nil:
		return nil, errors.New("shift planning: the instance, assignment, room and activity group readers are required")
	case deps.DB == nil || deps.LockStaffAssignments == nil:
		return nil, errors.New("shift planning: the database handle and the staff row lock are required for the per-staff write locks")
	}

	logger := deps.Logger
	shiftTypes := planning.NewShiftTypeService(deps.Workforce, logger)

	lockStaffShifts := NewStaffShiftLock(deps.DB)
	shifts := planning.NewStaffShiftService(deps.Workforce, deps.Staff, shiftTypes, lockStaffShifts, logger, deps.ShiftMoveAudit, planning.ShiftSchedule{
		Today: deps.Today, Absences: deps.Workforce, Exceptions: deps.Workforce, LockStaffRows: deps.LockStaffAssignments, Broadcaster: deps.Broadcaster,
		Guard: planning.NewPlanGuard(postgres.New(postgres.DatabaseRuntime(deps.DB)), deps.PlanRules, deps.Holidays, planning.WorkingTimeOverrideAudit(deps.WorkingTimeAudit)),
	})

	series := planning.NewStaffShiftSeriesService(
		deps.Workforce, deps.Workforce, deps.Workforce, deps.Staff, planning.SchoolCalendarPeriods(deps.CalendarPeriods),
		shiftTypes, lockStaffShifts, logger, shifts, planning.SeriesSchedule{
			Today: deps.Today, Absences: deps.Workforce, Broadcaster: deps.Broadcaster, NonWorkingDays: planning.SchoolCalendarNonWorkingDays(deps.NonWorkingDays),
		},
	)

	assignments := planning.NewStaffAssignmentService(planning.StaffAssignmentDependencies{
		InstanceStaffRepo:    deps.InstanceStaff,
		ActivityInstanceRepo: deps.Instances,
		RoomRepo:             deps.Rooms,
		ActivityGroupRepo:    deps.ActivityGroups,
	}, logger)

	overview := planning.NewStaffScheduleOverviewService(planning.StaffScheduleOverviewDependencies{
		PlanningProfiles: deps.Workforce,
		Shifts:           deps.Workforce, Instances: deps.Instances, InstanceStaff: deps.InstanceStaff,
		Rooms: deps.Rooms, Staff: deps.Staff, WorkSchedules: deps.WorkSchedules, WorkModels: deps.WorkModels,
		Holidays: deps.Holidays, TargetOverrides: deps.Workforce,
	})

	return &ShiftPlanning{
		ShiftTypes:  planning.NewShiftTypeAdministration(shiftTypes, deps.CategoryLinker),
		Assignments: planning.NewStaffAssignmentQuery(assignments),
		Overview:    planning.NewStaffScheduleOverviewQuery(overview),
		shifts:      shifts,
		series:      series,
		overview:    overview,
	}, nil
}

// Planning binds the public staff-shift facade. planExport may be nil, in
// which case ExportPlan reports that the export is not configured instead of
// panicking; every other route stays available.
func (p *ShiftPlanning) Planning(planExport planexport.Service) workforce.StaffShiftPlanning {
	return planning.NewStaffShiftPlanning(planning.PlanningDependencies{
		Shifts: p.shifts, Series: p.series, Overview: p.overview, PlanExport: planExport,
	})
}

// TraegerSites binds the Einsatzplanung of the Träger to each school's Dienstplan (ADR 0242).
func (p *ShiftPlanning) TraegerSites(public workforce.StaffShiftPlanning) workforce.TraegerShiftSites {
	return planning.NewTraegerSites(p.shifts, public)
}
