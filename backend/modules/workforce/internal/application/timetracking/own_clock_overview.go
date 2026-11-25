package timetracking

import (
	"context"
	"slices"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/workforce"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

func (s ownTimeViews) ClockOverview(ctx context.Context, staffID int64) (workforce.OwnClockOverview, error) {
	now := s.months.now()
	today := calendar.DateFromTime(now)
	result, err := s.clockSummary(ctx, staffID, today, now)
	if err != nil {
		return workforce.OwnClockOverview{}, err
	}
	_, result.Shifts, err = s.ownedShifts(ctx, staffID, today, today)
	if err != nil {
		return workforce.OwnClockOverview{}, err
	}
	result.Assignments, err = s.ownedAssignments(ctx, staffID, today)
	if err != nil {
		return workforce.OwnClockOverview{}, err
	}
	return result, nil
}

func (s ownTimeViews) clockSummary(ctx context.Context, staffID int64, today calendar.Date, now time.Time) (workforce.OwnClockOverview, error) {
	open, err := s.sessions.GetLatestOpenSession(ctx, staffID)
	if err != nil {
		return workforce.OwnClockOverview{}, err
	}
	key := monthOf(today)
	anchor, err := s.months.chainAnchor(ctx, key)
	if err != nil {
		return workforce.OwnClockOverview{}, err
	}
	chain, err := s.months.carryChainStart(ctx, staffID, key, anchor)
	if err != nil {
		return workforce.OwnClockOverview{}, err
	}
	chartDays := ownChartDays(today)
	week := today.StartOfISOWeek()
	weekEnd := week.AddDays(6)
	facts, err := s.facts(ctx, staffID, min(chartDays[0], week, chain.first), max(weekEnd, key.lastDay()), today, now, open, s.months.holidayReader)
	if err != nil {
		return workforce.OwnClockOverview{}, err
	}
	summary, err := s.summary(ctx, staffID, key, chain, facts, nil)
	if err != nil {
		return workforce.OwnClockOverview{}, err
	}
	currentAbsence, err := s.clockAbsence(ctx, today, facts.absences)
	if err != nil {
		return workforce.OwnClockOverview{}, err
	}
	return facts.projectClock(staffID, open, currentAbsence, chartDays, anchor, summary), nil
}

// The first absence in the same date ordering as the old absence read
// triggers the warning, regardless of whether the person proceeds.
func (s ownTimeViews) clockAbsence(ctx context.Context, today calendar.Date, absences []*StaffAbsence) (*workforce.OwnTimeAbsence, error) {
	for _, a := range absences {
		if a.DateStart.After(today) || a.DateEnd.Before(today) {
			continue
		}
		rows, err := s.ownAbsenceRows(ctx, []*StaffAbsence{a})
		if err != nil {
			return nil, err
		}
		return &rows[0], nil
	}
	return nil, nil
}

func (facts ownTimeFacts) projectClock(staffID int64, open *WorkSession, currentAbsence *workforce.OwnTimeAbsence, chartDays [10]calendar.Date, anchor calendar.Date, summary *MonthSummary) workforce.OwnClockOverview {
	today, now := facts.today, facts.now
	week := today.StartOfISOWeek()
	weekEnd := week.AddDays(6)
	key := monthOf(today)
	result := workforce.OwnClockOverview{
		Today: today, AsOf: now, StaffID: ident.ID(staffID), TodayAbsence: currentAbsence,
		TodayCountsInTotals: !excludedByAccountStart(today, anchor),
		Chart:               facts.chart(chartDays),
		LaborDays:           facts.laborDays(min(week, today.AddDays(-1)), today), AccountStart: anchor,
		Week: ownWeekTotals(facts.daily(week, weekEnd, anchor)),
		Month: workforce.OwnTimeTotals{
			HasTarget: summary.HasTarget, HasOverride: facts.hasOverride(key.firstDay(), key.lastDay()),
			TargetMinutes: summary.TargetMinutes, ActualMinutes: summary.ActualMinutes,
			CreditMinutes:  summary.CreditedSickMinutes + summary.CreditedVacationMinutes + summary.CreditedTrainingMinutes + summary.CreditedOtherMinutes,
			BalanceMinutes: summary.BalanceMinutes,
		},
	}
	if !today.Before(anchor) {
		result.AccountBalance = &summary.ClosingBalanceMinutes
	}
	if open != nil {
		response := sessionHistoryResponses([]*WorkSession{open}, facts.breaks, nil, nil, now)[0]
		block := ownBlock(response)
		result.Session = &block
	}
	closed := slices.DeleteFunc(slices.Clone(facts.sessions), func(row *WorkSession) bool { return row.CheckOutTime == nil })
	result.CompletedToday = actualMinutesByDay(closed, facts.breaks, now, today, today, today)[today]
	for _, summary := range facts.weeklySummaries(week, weekEnd, anchor) {
		result.IsOverWeeklyMax = result.IsOverWeeklyMax || summary.IsOverWeeklyMax
	}
	return result
}

func (facts ownTimeFacts) hasOverride(from, to calendar.Date) bool {
	for day := from; !day.After(to); day = day.AddDays(1) {
		if facts.targets.SourceFor(day) == workforce.TargetSourceOverride {
			return true
		}
	}
	return false
}

func ownWeekTotals(days []workforce.OwnTimeDay) workforce.OwnTimeTotals {
	var result workforce.OwnTimeTotals
	for _, day := range days {
		result.HasTarget = result.HasTarget || day.HasTarget
		result.HasOverride = result.HasOverride || day.TargetSource == workforce.TargetSourceOverride
		result.TargetMinutes += day.TargetMinutes
		result.ActualMinutes += day.ActualMinutes
		result.CreditMinutes += day.CreditMinutes
		result.BalanceMinutes += day.BalanceMinutes
	}
	return result
}

func ownChartDays(today calendar.Date) [10]calendar.Date {
	var days [10]calendar.Date
	for i, day := len(days)-1, today; i >= 0; day = day.AddDays(-1) {
		if day.Weekday() != time.Saturday && day.Weekday() != time.Sunday {
			days[i] = day
			i--
		}
	}
	return days
}

func (f ownTimeFacts) chart(days [10]calendar.Date) []workforce.OwnTimeChartPoint {
	breaks := make(map[calendar.Date]int)
	from, to := days[0], days[len(days)-1]
	for _, block := range f.sessions {
		end := balanceSessionEnd(block, f.now, f.today)
		if !end.After(from.BerlinMidnight()) || !block.CheckInTime.Before(to.AddDays(1).BerlinMidnight()) {
			continue
		}
		walkStampedMinutesByDay(block, f.breaks[block.ID], end, from, to, func(day calendar.Date, _, minutes int) {
			breaks[day] += minutes
		})
	}
	points := make([]workforce.OwnTimeChartPoint, 0, len(days))
	for _, day := range days {
		points = append(points, workforce.OwnTimeChartPoint{Date: day, ActualMinutes: f.actual[day], BreakMinutes: breaks[day]})
	}
	return points
}
