package planning

import (
	"context"
	"fmt"
	"maps"
	"slices"

	"github.com/moto-ogs/project-phoenix/modules/workforce"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// TraegerSiteReads are the reads of one school the Einsatzplanung of the
// Träger needs beyond its Dienstplan (#4708).
type TraegerSiteReads interface {
	PlanCheckReads
	CountShiftsAfter(ctx context.Context, after calendar.Date) (int, error)
}

// traegerSites serves the Einsatzplanung of the Träger at the school of the
// tenant transaction, over the same shift service, holidays and Träger
// values as the school's own Dienstplan.
type traegerSites struct {
	TraegerSiteReads
	shifts   *staffShiftService
	holidays HolidayDatesReader
	settings PlanRuleSettings
	planning workforce.StaffShiftPlanning
}

// NewTraegerSites binds the Einsatzplanung of the Träger to the Dienstplan
// of each school, with the reads, holidays and Träger values of the shift
// service's working-time check.
func NewTraegerSites(shifts StaffShiftService, planning workforce.StaffShiftPlanning) workforce.TraegerShiftSites {
	service, ok := shifts.(*staffShiftService)
	if !ok || service.guard == nil || planning == nil {
		panic("workforce traeger sites: the shift service with its working-time check and the planning are required")
	}
	guard := service.guard
	return traegerSites{TraegerSiteReads: guard.reads, shifts: service, holidays: guard.holidays, settings: guard.settings, planning: planning}
}

// SiteWeek reads the school's part of the week of the Einsatzplanung.
func (t traegerSites) SiteWeek(ctx context.Context, query workforce.TraegerSiteWeekQuery) (workforce.TraegerSiteWeek, error) {
	rules, err := t.siteRules(ctx)
	if err != nil {
		return workforce.TraegerSiteWeek{}, err
	}
	shifts, err := t.shifts.repo.ReadShifts(ctx, workforce.StaffShiftFilter{
		StaffIDs: query.StaffIDs, From: query.From.String(), To: query.To.String(),
		Order: shiftOrder(workforce.StaffShiftOrderDate, workforce.StaffShiftOrderStartTime),
	})
	if err = shiftReadError("find staff shifts of the Einsatzplanung", err, nil); err != nil {
		return workforce.TraegerSiteWeek{}, err
	}
	if err := t.shifts.attachShiftTypes(ctx, shifts); err != nil {
		return workforce.TraegerSiteWeek{}, err
	}
	soll, err := t.siteSoll(ctx, query.SollRecordIDs, query.SollFrom, query.SollTo)
	if err != nil {
		return workforce.TraegerSiteWeek{}, err
	}
	// Absences only matter where the contract can suggest a shift: a week
	// with Soll at the school that reaches today or later.
	var absent []workforce.TraegerSiteAbsentDay
	if len(soll) > 0 && !query.SollTo.Before(t.shifts.todayDate()) {
		if absent, err = t.absentDays(ctx, query.StaffIDs, query.SollFrom, query.SollTo); err != nil {
			return workforce.TraegerSiteWeek{}, err
		}
	}
	return workforce.TraegerSiteWeek{Shifts: plannedShiftsToCapability(shifts), Soll: soll, AbsentDays: absent, Rules: rules}, nil
}

// absentDays reads the full absence days of the employments in one query,
// by the rule a created shift takes its absence state from (#6302): a shift
// planned on such a day is cancelled at once.
func (t traegerSites) absentDays(ctx context.Context, staffIDs []int64, from, to calendar.Date) ([]workforce.TraegerSiteAbsentDay, error) {
	reader := t.shifts.sickReports
	if reader == nil || len(staffIDs) == 0 || from == "" {
		return nil, nil
	}
	absences, err := reader.ListStaffAbsences(ctx, workforce.StaffAbsenceFilter{
		StaffIDs: staffIDs, Statuses: workforce.PlanEffectiveAbsenceStatuses(), OverlapFrom: from.String(), OverlapTo: to.String(),
	})
	if err != nil {
		return nil, fmt.Errorf("list absences of the Einsatzplanung: %w", err)
	}
	byStaff := map[int64][]workforce.StaffAbsence{}
	for _, absence := range absences {
		byStaff[absence.StaffID.Int64()] = append(byStaff[absence.StaffID.Int64()], absence)
	}
	var result []workforce.TraegerSiteAbsentDay
	for _, staffID := range staffIDs {
		days, err := sickDayIndex(byStaff[staffID], from, to)
		if err != nil {
			return nil, err
		}
		for _, day := range slices.SortedFunc(maps.Keys(days), calendar.Date.Compare) {
			result = append(result, workforce.TraegerSiteAbsentDay{StaffID: staffID, Date: day})
		}
	}
	return result, nil
}

// SiteShift reads one shift of the school with its type.
func (t traegerSites) SiteShift(ctx context.Context, shiftID int64) (workforce.PlannedShift, error) {
	shift, err := t.shifts.findShiftOrNotFound(ctx, shiftID, "find staff shift of the Einsatzplanung")
	if err != nil {
		return workforce.PlannedShift{}, mapPlanningError(err)
	}
	if err := t.shifts.attachShiftTypes(ctx, []*workforce.ShiftRecord{shift}); err != nil {
		return workforce.PlannedShift{}, err
	}
	return plannedShiftToCapability(shift), nil
}

// siteSoll reads the school's own share of the records' Soll, without its
// holidays and closing days; the week view adds the shares of every school.
func (t traegerSites) siteSoll(ctx context.Context, recordIDs []int64, from, to calendar.Date) ([]workforce.ShiftPlanSollDay, error) {
	if len(recordIDs) == 0 {
		return nil, nil
	}
	days, err := t.ShiftPlanSoll(ctx, recordIDs, from, to)
	if err != nil {
		return nil, err
	}
	holidays := map[calendar.Date]bool{}
	if t.holidays != nil {
		if holidays, err = t.holidays.HolidayDates(ctx, from, to); err != nil {
			return nil, fmt.Errorf("read holidays of the Einsatzplanung: %w", err)
		}
	}
	return slices.DeleteFunc(days, func(day workforce.ShiftPlanSollDay) bool { return !day.Own || holidays[day.Date] }), nil
}

// siteRules resolves the Träger values as the school sees them.
func (t traegerSites) siteRules(ctx context.Context) (workforce.TraegerPlanningRules, error) {
	guard := planGuard{settings: t.settings}
	rules, err := guard.rules(ctx)
	if err != nil {
		return workforce.TraegerPlanningRules{}, err
	}
	enabled := true
	if t.settings != nil {
		if enabled, _, _, _, err = t.settings.StaffPlanningRules(ctx); err != nil {
			return workforce.TraegerPlanningRules{}, fmt.Errorf("resolve staff planning setting: %w", err)
		}
	}
	return workforce.TraegerPlanningRules{Enabled: enabled, MaxDailyMinutes: rules.MaxDailyMinutes, MinRestMinutes: rules.MinRestMinutes, CheckBreaks: rules.CheckBreaks}, nil
}

func (t traegerSites) SitePlanning() workforce.StaffShiftPlanning { return t.planning }
