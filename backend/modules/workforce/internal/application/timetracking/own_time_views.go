package timetracking

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"slices"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/workforce"
	"github.com/moto-ogs/project-phoenix/modules/workforce/internal/domain"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
	"github.com/moto-ogs/project-phoenix/tenant"
)

type ownTimeViews struct {
	months   *workTimeMonthService
	sessions WorkSessionService
	absences *staffAbsenceService
	edits    WorkSessionAudit
	mails    workforce.AbsenceMailStatus
	planning workforce.OwnTimeViewPlanning
}

type ownTimeFacts struct {
	now      time.Time
	today    calendar.Date
	sessions []*WorkSession
	breaks   map[int64][]*WorkSessionBreak
	absences []*StaffAbsence
	actual   map[calendar.Date]int
	targets  *dailyTargetResolver
}

// facts reads the union of the table, labor and carry-chain windows once.
// An open block can have been filed outside the overlap range; it is included
// in the break batch but does not replace the rows used for the time figures.
func (s ownTimeViews) facts(ctx context.Context, staffID int64, from, to calendar.Date, today calendar.Date, now time.Time, open *WorkSession, days HolidayDatesReader) (ownTimeFacts, error) {
	end := to.AddDays(1).BerlinMidnight()
	rows, err := s.months.sessionRepo.ListOverlappingWorkSessions(ctx, []int64{staffID}, from.BerlinMidnight(), &end)
	if err != nil {
		return ownTimeFacts{}, fmt.Errorf("own time views: sessions: %w", err)
	}
	sessions := workSessionsToRecords(rows)
	breakSessions := sessions
	if open != nil && !slices.ContainsFunc(sessions, func(row *WorkSession) bool { return row.ID == open.ID }) {
		breakSessions = append(slices.Clone(sessions), open)
	}
	breaks, err := s.months.breaksBySessionID(ctx, breakSessions)
	if err != nil {
		return ownTimeFacts{}, err
	}
	absences, err := s.months.absenceRepo.ListStaffAbsences(ctx, workforce.StaffAbsenceFilter{
		StaffID: staffID, OverlapFrom: from.String(), OverlapTo: to.String(),
		Order: []workforce.StaffAbsenceOrder{{Field: workforce.StaffAbsenceOrderDateStart}, {Field: workforce.StaffAbsenceOrderID}},
	})
	if err != nil {
		return ownTimeFacts{}, fmt.Errorf("own time views: absences: %w", err)
	}
	months := *s.months
	months.holidayReader = days
	targets, err := months.buildTargetResolver(ctx, staffID, from, to)
	if err != nil {
		return ownTimeFacts{}, err
	}
	return ownTimeFacts{
		now: now, today: today, sessions: sessions, breaks: breaks, absences: absencesToRecord(absences),
		actual: actualMinutesByDay(sessions, breaks, now, today, from, min(to, today)), targets: targets,
	}, nil
}

func (f ownTimeFacts) daily(from, to, anchor calendar.Date) []workforce.OwnTimeDay {
	credits := absenceCreditsByDay(f.absences, from, min(to, f.today), f.targets)
	days := projectWorkDays(from, to, f.today, anchor, f.targets, credits, f.actual)
	result := make([]workforce.OwnTimeDay, 0, len(days))
	for _, d := range days {
		result = append(result, workforce.OwnTimeDay{
			Date: d.Date, HasTarget: f.targets.Maintains(d.Date) || excludedByAccountStart(d.Date, anchor),
			TargetSource: d.TargetSource, TargetMinutes: d.TargetMinutes, ActualMinutes: d.ActualMinutes,
			CreditMinutes: d.CreditMinutes, BalanceMinutes: d.BalanceMinutes,
		})
	}
	return result
}

func (s ownTimeViews) summary(ctx context.Context, staffID int64, key monthKey, chain carryChain, facts ownTimeFacts, shifts []workforce.PlannedShift) (*MonthSummary, error) {
	first, last := chain.first, key.lastDay()
	aggregates := monthTargets(first, last, facts.today, facts.targets)
	for day, minutes := range facts.actual {
		if agg := aggregates[monthOf(day)]; agg != nil && !day.Before(first) {
			agg.actual += minutes
		}
	}
	addMonthAbsenceCredits(facts.absences, first, min(last, facts.today), facts.targets, aggregates)
	if err := s.months.addAdjustments(ctx, staffID, first, last, facts.today, aggregates); err != nil {
		return nil, err
	}
	for _, shift := range shifts {
		day := calendar.Date(shift.Date)
		if day.Before(max(first, key.firstDay())) || day.After(last) {
			continue
		}
		agg := aggregates[key]
		agg.hasShifts = true
		if !shift.Cancelled {
			start, startErr := time.Parse(workforce.ClockLayout, shift.StartTime)
			end, endErr := time.Parse(workforce.ClockLayout, shift.EndTime)
			if err := errors.Join(startErr, endErr); err != nil {
				return nil, fmt.Errorf("own time views: planned shift clock: %w", err)
			}
			agg.plannedShift += shiftNetMinutes(&TimeTrackingShift{StartTime: start, EndTime: end, BreakMinutes: shift.BreakMinutes})
		}
	}
	return summarizeCarryChain(staffID, key, chain, aggregates), nil
}

func (s ownTimeViews) Period(ctx context.Context, staffID int64, view string, start calendar.Date) (workforce.OwnTimePeriod, error) {
	now := s.months.now()
	today := calendar.DateFromTime(now)
	key := monthOf(start)
	end, err := ownPeriodEnd(view, start, today)
	if err != nil {
		return workforce.OwnTimePeriod{}, err
	}
	anchor, err := s.months.chainAnchor(ctx, key)
	if err != nil {
		return workforce.OwnTimePeriod{}, err
	}
	weekStart, weekEnd := start.StartOfISOWeek(), end.StartOfISOWeek().AddDays(6)
	from, to := weekStart.AddDays(-1), weekEnd
	var chain carryChain
	if view == workforce.OwnTimeMonth {
		chain, err = s.months.carryChainStart(ctx, staffID, key, anchor)
		if err != nil {
			return workforce.OwnTimePeriod{}, err
		}
		from = min(from, chain.first)
	}
	days, err := readOwnCalendar(ctx, s.planning.Calendar, from, to, start, end)
	if err != nil {
		return workforce.OwnTimePeriod{}, err
	}
	facts, err := s.facts(ctx, staffID, from, to, today, now, nil, days)
	if err != nil {
		return workforce.OwnTimePeriod{}, err
	}
	return s.projectPeriod(ctx, staffID, view, start, end, weekStart, weekEnd, anchor, facts, days, chain)
}

func ownPeriodEnd(view string, start, today calendar.Date) (calendar.Date, error) {
	if start.IsZero() || start.Year() < 2000 || start.Year() > 2100 {
		return "", workforce.ErrInvalidOwnTimePeriod
	}
	switch view {
	case workforce.OwnTimeWeek:
		if start.Weekday() == time.Monday {
			return start.AddDays(6), nil
		}
	case workforce.OwnTimeMonth:
		key := monthOf(start)
		if start == key.firstDay() && !monthOf(today).addMonths(maxFutureMonths).before(key) {
			return key.lastDay(), nil
		}
	}
	return "", workforce.ErrInvalidOwnTimePeriod
}

func (s ownTimeViews) projectPeriod(ctx context.Context, staffID int64, view string, start, end, weekStart, weekEnd, anchor calendar.Date, facts ownTimeFacts, days ownCalendar, chain carryChain) (workforce.OwnTimePeriod, error) {
	history, err := s.periodBlocks(ctx, facts, weekStart, weekEnd)
	if err != nil {
		return workforce.OwnTimePeriod{}, err
	}
	shifts, shiftView, err := s.ownedShifts(ctx, staffID, start, end)
	if err != nil {
		return workforce.OwnTimePeriod{}, err
	}
	absences := slices.DeleteFunc(slices.Clone(facts.absences), func(a *StaffAbsence) bool {
		return a.DateEnd.Before(start) || a.DateStart.After(end)
	})
	absenceRows, err := s.ownAbsenceRows(ctx, absences)
	if err != nil {
		return workforce.OwnTimePeriod{}, err
	}
	result := workforce.OwnTimePeriod{
		StaffID: ident.ID(staffID),
		View:    view, Start: start, End: end, WeekStart: weekStart, WeekEnd: weekEnd, AccountStart: anchor,
		Sessions: history, LaborDays: facts.laborDays(weekStart, weekEnd),
		RestHints:       restHints(facts.sessions, weekStart, weekEnd),
		WeeklySummaries: facts.weeklySummaries(weekStart, weekEnd, anchor),
		Absences:        absenceRows, Shifts: shiftView, Holidays: days.holidays, ClosingDays: days.closing,
		Days: facts.daily(start, end, anchor),
	}
	if view == workforce.OwnTimeMonth {
		summary, err := s.summary(ctx, staffID, monthOf(start), chain, facts, shifts)
		if err != nil {
			return workforce.OwnTimePeriod{}, err
		}
		result.MonthSummary = &workforce.OwnTimeMonthSummary{
			MonthSummary: *publicMonthSummary(summary), PlannedShiftState: shiftView.State,
		}
	}
	return result, nil
}

func (s ownTimeViews) periodBlocks(ctx context.Context, facts ownTimeFacts, from, to calendar.Date) ([]workforce.OwnTimeBlock, error) {
	blocks := make([]*WorkSession, 0)
	ids := make([]int64, 0)
	start, end := from.BerlinMidnight(), to.AddDays(1).BerlinMidnight()
	for _, row := range facts.sessions {
		if row.CheckInTime.Before(end) && (row.CheckOutTime == nil || row.CheckOutTime.After(start)) {
			blocks = append(blocks, row)
			ids = append(ids, row.ID)
		}
	}
	result := make([]workforce.OwnTimeBlock, 0, len(blocks))
	if len(blocks) == 0 {
		return result, nil
	}
	manual, err := s.edits.CountManualBySessionIDs(ctx, ids)
	if err != nil {
		return nil, fmt.Errorf("own time period: manual edits: %w", err)
	}
	all, err := s.edits.CountBySessionIDs(ctx, ids)
	if err != nil {
		return nil, fmt.Errorf("own time period: audit counts: %w", err)
	}
	for _, block := range sessionHistoryResponses(blocks, facts.breaks, manual, all, facts.now) {
		result = append(result, ownBlock(block))
	}
	return result, nil
}

func (f ownTimeFacts) laborDays(from, to calendar.Date) []workforce.WorkDayLaborHint {
	hints := WorkDayLaborHints(f.sessions, f.breaks, f.now, from, to)
	result := make([]workforce.WorkDayLaborHint, 0, len(hints))
	for _, h := range hints {
		result = append(result, publicWorkDayLaborHint(h))
	}
	return result
}

func (f ownTimeFacts) weeklySummaries(from, to, anchor calendar.Date) []workforce.WorkWeekSummary {
	targets := make(map[summaryWeekKey]int)
	for _, day := range f.daily(from, to, anchor) {
		if day.HasTarget {
			targets[summaryKeyOf(day.Date.StartOfISOWeek())] += day.TargetMinutes
		}
	}
	rows := make([]*SessionResponse, 0, len(f.sessions))
	for _, session := range f.sessions {
		rows = append(rows, &SessionResponse{WorkSession: session, Breaks: f.breaks[session.ID]})
	}
	weeks := weeklyWorkSummaries(rows, targets, from, to, f.now)
	result := make([]workforce.WorkWeekSummary, 0, len(weeks))
	for _, week := range weeks {
		result = append(result, workforce.WorkWeekSummary(week))
	}
	return result
}

// Rest is measured between the last finished block of one workday and the
// first stamp of the next workday, with the real Berlin-night duration.
func restHints(sessions []*WorkSession, from, to calendar.Date) []workforce.OwnTimeRestHint {
	hints := make([]workforce.OwnTimeRestHint, 0)
	var previousDay calendar.Date
	var lastEnd time.Time
	for _, session := range sessions {
		day := calendar.DateFromTime(session.CheckInTime)
		if day.After(to) {
			break
		}
		if day != previousDay && !day.Before(from) && !lastEnd.IsZero() {
			if minutes := int(session.CheckInTime.Sub(lastEnd) / time.Minute); minutes < domain.StatutoryRestMinutes {
				hints = append(hints, workforce.OwnTimeRestHint{Date: day, RestMinutes: max(0, minutes), LimitMinutes: domain.StatutoryRestMinutes})
			}
		}
		previousDay = day
		if session.CheckOutTime != nil && session.CheckOutTime.After(lastEnd) {
			lastEnd = *session.CheckOutTime
		}
	}
	return hints
}

func ownBlock(block *SessionResponse) workforce.OwnTimeBlock {
	breaks := make([]workforce.OwnTimeBreak, 0, len(block.Breaks))
	for _, b := range block.Breaks {
		breaks = append(breaks, workforce.OwnTimeBreak{
			ID: ident.ID(b.ID), StartedAt: b.StartedAt, EndedAt: b.EndedAt,
			DurationMinutes: b.DurationMinutes, PlannedEndTime: b.PlannedEndTime,
		})
	}
	return workforce.OwnTimeBlock{
		ID: ident.ID(block.ID), Date: block.Date, CheckInTime: block.CheckInTime, CheckOutTime: block.CheckOutTime,
		Status: block.Status, Source: block.Source, Notes: block.Notes, AutoCheckedOut: block.AutoCheckedOut,
		NetMinutes: block.NetMinutes, BreakMinutes: block.BreakMinutes, IsOvertime: block.IsOvertime, IsBreakCompliant: block.IsBreakCompliant,
		PackUpMinutes: block.PackUpMinutes, RoundingMinutes: block.RoundingMinutes,
		EditCount: block.EditCount, AuditCount: block.AuditCount, Version: block.Version, Breaks: breaks,
	}
}

// Isolated reads opt out independently without returning a false empty result
// or leaving the request transaction aborted after a PostgreSQL error.
func optionalOwnRead[T any](ctx context.Context, logger *slog.Logger, part string, read func(context.Context) (T, error)) (T, string, error) {
	var result T
	err := tenant.WithSavepoint(ctx, func(ctx context.Context) error {
		var err error
		result, err = read(ctx)
		return err
	})
	if err == nil {
		return result, workforce.OwnReadReady, nil
	}
	var empty T
	if tenant.IsSavepointControlFailure(err) || ctx.Err() != nil {
		return empty, workforce.OwnReadUnavailable, err
	}
	logger.WarnContext(ctx, "own time tracking read incomplete",
		"part", part,
		"error", err,
	)
	return empty, workforce.OwnReadUnavailable, nil
}
