package planning

import (
	"context"
	"errors"
	"fmt"
	"slices"

	"github.com/moto-ogs/project-phoenix/modules/workforce"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

// Series shifts on closing days (#8205). A series that leaves out Ferien and
// closing days applies the rule when it plans; FollowBreakDays carries a
// later change of the school's closing days into the shifts already planned,
// in the transaction of that change. Every read is set-based: the shifts of
// the window, the calendar once, the covers and the absences once.

// breakDayListHorizonDays bounds BreakDayShifts: about a school year ahead,
// as far as series plan.
const breakDayListHorizonDays = 400

// breakDayClockLayout renders the shift window as "HH:MM", like the shift routes.
const breakDayClockLayout = "15:04"

// BreakDayShiftRecords are the shift reads and the bulk write of the
// break-day follow-up; the Workforce capability satisfies them.
type BreakDayShiftRecords interface {
	ShiftReads
	ApplyBreakDayShiftStates(ctx context.Context, states []workforce.BreakDayShiftState) error
}

// BreakDayDependencies are the collaborators of NewSeriesBreakDays; all are
// required.
type BreakDayDependencies struct {
	Shifts   BreakDayShiftRecords
	Absences SickReportReader
	Calendar SchoolBreakCalendarReader
	// LockStaffShifts is the per-staff shift gate shared with every shift write.
	LockStaffShifts func(ctx context.Context, staffID int64) error
	Today           func() calendar.Date
}

// NewSeriesBreakDays binds the break-day follow-up and its list.
func NewSeriesBreakDays(deps BreakDayDependencies) (workforce.SeriesBreakDays, error) {
	if deps.Shifts == nil || deps.Absences == nil || deps.Calendar == nil || deps.LockStaffShifts == nil || deps.Today == nil {
		return nil, errors.New("shift planning: the break-day follow-up needs the shifts, the absences, the calendar, the shift lock and the day clock")
	}
	return &seriesBreakDays{deps: deps}, nil
}

type seriesBreakDays struct{ deps BreakDayDependencies }

// FollowBreakDays reconciles the series shifts of [from, to] from tomorrow
// on. It locks the people with series shifts in the window, ascending, then
// reads their shifts again under the locks and writes every change in one
// statement.
func (b *seriesBreakDays) FollowBreakDays(ctx context.Context, from, to calendar.Date) error {
	if tomorrow := b.deps.Today().AddDays(1); from.Before(tomorrow) {
		from = tomorrow
	}
	if to.Before(from) {
		return nil
	}
	window := workforce.StaffShiftFilter{From: from.String(), To: to.String()}
	unlocked, err := b.deps.Shifts.ReadShifts(ctx, window)
	if err != nil {
		return fmt.Errorf("break days: read shifts: %w", err)
	}
	staffIDs := breakSeriesStaff(unlocked)
	if len(staffIDs) == 0 {
		return nil
	}
	for _, staffID := range staffIDs {
		if err := b.deps.LockStaffShifts(ctx, staffID); err != nil {
			return fmt.Errorf("break days: lock shifts of staff %d: %w", staffID, err)
		}
	}
	window.StaffIDs = staffIDs
	shifts, err := b.deps.Shifts.ReadShifts(ctx, window)
	if err != nil {
		return fmt.Errorf("break days: read locked shifts: %w", err)
	}
	breaks, err := b.deps.Calendar.SchoolBreakCalendar(ctx, from, to)
	if err != nil {
		return err
	}
	states, reopened := breakDayStates(shifts, breaks)
	restored, err := b.restoreStates(ctx, shifts, reopened, from, to)
	if err != nil {
		return err
	}
	if err := b.deps.Shifts.ApplyBreakDayShiftStates(ctx, append(states, restored...)); err != nil {
		return fmt.Errorf("break days: write shift states: %w", err)
	}
	return nil
}

// BreakDayShifts lists the active series shifts that stand on a day their
// series leaves out, from tomorrow on.
func (b *seriesBreakDays) BreakDayShifts(ctx context.Context) ([]workforce.SeriesBreakDayShift, error) {
	from := b.deps.Today().AddDays(1)
	to := from.AddDays(breakDayListHorizonDays)
	breaks, err := b.deps.Calendar.SchoolBreakCalendar(ctx, from, to)
	if err != nil {
		return nil, err
	}
	dates := breaks.breakDates()
	result := []workforce.SeriesBreakDayShift{}
	if len(dates) == 0 {
		return result, nil
	}
	active := false
	shifts, err := b.deps.Shifts.ReadShifts(ctx, workforce.StaffShiftFilter{
		Dates: dates, Cancelled: &active,
		Order: shiftOrder(workforce.StaffShiftOrderDate, workforce.StaffShiftOrderStartTime),
	})
	if err != nil {
		return nil, fmt.Errorf("break days: read shifts: %w", err)
	}
	for _, shift := range shifts {
		if !skipsSchoolBreaks(shift) {
			continue
		}
		if kind := breaks.breakKind(shift.Date, shift.SeriesCalendarPeriodID); kind != "" {
			result = append(result, workforce.SeriesBreakDayShift{
				ShiftID: ident.ID(shift.ID), StaffID: ident.ID(shift.StaffID), Date: shift.Date.String(),
				StartTime: shift.StartTime.Format(breakDayClockLayout), EndTime: shift.EndTime.Format(breakDayClockLayout),
				Break: kind, Adjusted: !followsSeries(shift),
			})
		}
	}
	return result, nil
}

// restoreStates plans the reopened shifts again. A shift that meanwhile got
// a cover, or whose window another active shift of the person now takes,
// stays cancelled: that is the planner's work. On a full absence day of the
// person the shift takes the absence's state instead (#6302).
func (b *seriesBreakDays) restoreStates(ctx context.Context, shifts, reopened []*workforce.ShiftRecord, from, to calendar.Date) ([]workforce.BreakDayShiftState, error) {
	if len(reopened) == 0 {
		return nil, nil
	}
	ids := make([]int64, 0, len(reopened))
	for _, shift := range reopened {
		ids = append(ids, shift.ID)
	}
	covers, err := b.deps.Shifts.ReadShifts(ctx, workforce.StaffShiftFilter{OriginShiftIDs: ids})
	if err != nil {
		return nil, fmt.Errorf("break days: read covers: %w", err)
	}
	covered := make(map[int64]bool, len(covers))
	for _, cover := range covers {
		if cover.OriginShiftID != nil {
			covered[*cover.OriginShiftID] = true
		}
	}
	absent, err := b.absenceDays(ctx, reopened, from, to)
	if err != nil {
		return nil, err
	}
	states := make([]workforce.BreakDayShiftState, 0, len(reopened))
	for _, shift := range reopened {
		if covered[shift.ID] || overlapsOtherActiveShift(shift, shifts) {
			continue
		}
		states = append(states, restoredState(shift, absent[shift.StaffID]))
	}
	return states, nil
}

// absenceDays reads the absences in force of the reopened shifts' people
// once and indexes their full absence days per person.
func (b *seriesBreakDays) absenceDays(ctx context.Context, reopened []*workforce.ShiftRecord, from, to calendar.Date) (map[int64]map[calendar.Date]absenceStamp, error) {
	absences, err := b.deps.Absences.ListStaffAbsences(ctx, workforce.StaffAbsenceFilter{
		StaffIDs: breakSeriesStaff(reopened), Statuses: workforce.PlanEffectiveAbsenceStatuses(),
		OverlapFrom: from.String(), OverlapTo: to.String(),
	})
	if err != nil {
		return nil, fmt.Errorf("break days: list absences: %w", err)
	}
	byStaff := map[int64][]workforce.StaffAbsence{}
	for _, absence := range absences {
		byStaff[absence.StaffID.Int64()] = append(byStaff[absence.StaffID.Int64()], absence)
	}
	result := make(map[int64]map[calendar.Date]absenceStamp, len(byStaff))
	for staffID, own := range byStaff {
		days, err := sickDayIndex(own, from, to)
		if err != nil {
			return nil, err
		}
		result[staffID] = days
	}
	return result, nil
}

// breakDayStates decides every shift of the window: an unchanged active
// shift on a break day is cancelled with the day's label, a shift this
// follow-up cancelled keeps the label of its day, and one whose day opened
// is returned for restoreStates.
func breakDayStates(shifts []*workforce.ShiftRecord, breaks SchoolBreakCalendar) (states []workforce.BreakDayShiftState, reopened []*workforce.ShiftRecord) {
	for _, shift := range shifts {
		if !skipsSchoolBreaks(shift) || !followsSeries(shift) {
			continue
		}
		kind := breaks.breakKind(shift.Date, shift.SeriesCalendarPeriodID)
		cancelledByBreak := shift.Cancelled && shift.ChangeReason != nil && workforce.IsBreakDayShiftChangeReason(*shift.ChangeReason)
		switch {
		case kind != "" && !shift.Cancelled, kind != "" && cancelledByBreak && *shift.ChangeReason != breakReason(kind):
			reason := breakReason(kind)
			states = append(states, workforce.BreakDayShiftState{ShiftID: shift.ID, Cancelled: true, ChangeReason: &reason})
		case kind == "" && cancelledByBreak && !breaks.Holidays[shift.Date]:
			reopened = append(reopened, shift)
		}
	}
	return states, reopened
}

func restoredState(shift *workforce.ShiftRecord, absent map[calendar.Date]absenceStamp) workforce.BreakDayShiftState {
	stamp, ok := absent[shift.Date]
	if !ok {
		return workforce.BreakDayShiftState{ShiftID: shift.ID}
	}
	reason := workforce.ShiftChangeReasonFor(stamp.absenceType)
	absenceID := stamp.absenceID
	return workforce.BreakDayShiftState{ShiftID: shift.ID, Cancelled: true, ChangeReason: &reason, SickAbsenceID: &absenceID, Detached: true}
}

// skipsSchoolBreaks reports a series shift whose series leaves out the Ferien
// and closing days; a series that plans in them stays untouched.
func skipsSchoolBreaks(shift *workforce.ShiftRecord) bool {
	return shift.SeriesID != nil && !shift.SeriesIncludesBreaks
}

// followsSeries reports a shift still in the state its series planned:
// nobody edited, moved or covered it, and no absence stamped it.
func followsSeries(shift *workforce.ShiftRecord) bool {
	return !shift.Detached && !shift.SeriesOverride && shift.SickAbsenceID == nil && shift.OriginShiftID == nil
}

func breakReason(kind string) string {
	if kind == workforce.BreakDayHolidayPeriod {
		return workforce.HolidayPeriodShiftChangeReason
	}
	return workforce.ClosingDayShiftChangeReason
}

func overlapsOtherActiveShift(shift *workforce.ShiftRecord, shifts []*workforce.ShiftRecord) bool {
	for _, other := range shifts {
		if other.ID != shift.ID && other.StaffID == shift.StaffID && other.Date == shift.Date &&
			(!other.Cancelled || other.SickAbsenceID != nil) && shift.Overlaps(other) {
			return true
		}
	}
	return false
}

// breakSeriesStaff names, ascending, the people with a series shift that
// leaves out the breaks.
func breakSeriesStaff(shifts []*workforce.ShiftRecord) []int64 {
	var ids []int64
	for _, shift := range shifts {
		if skipsSchoolBreaks(shift) && !slices.Contains(ids, shift.StaffID) {
			ids = append(ids, shift.StaffID)
		}
	}
	slices.Sort(ids)
	return ids
}

// breakDates are the closing days and the Ferien days of the window,
// ascending, in DateLayout.
func (c SchoolBreakCalendar) breakDates() []string {
	days := c.ForSeries(0).Breaks
	dates := make([]string, 0, len(days))
	for day := range days {
		dates = append(dates, day.String())
	}
	slices.Sort(dates)
	return dates
}
