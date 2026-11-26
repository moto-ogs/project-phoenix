package application

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/mealplan"
	"github.com/moto-ogs/project-phoenix/modules/mealplan/internal/domain"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

func NewParticipantDirectory(find mealplan.ParticipantFinder, names mealplan.StudentNameFinder, days mealplan.ParticipantDaysFinder, lock mealplan.StudentLock) participantDirectory {
	return participantDirectory{find: find, names: names, days: days, lock: lock}
}

type participantDirectory struct {
	find  mealplan.ParticipantFinder
	names mealplan.StudentNameFinder
	days  mealplan.ParticipantDaysFinder
	lock  mealplan.StudentLock
}

// LockStudent takes the child's student row; ErrStudentNotFound when the
// school has no such child.
func (d participantDirectory) LockStudent(ctx context.Context, studentID int64) (domain.OperationStats, error) {
	started := time.Now()
	found, err := d.lock(ctx, studentID)
	stats := domain.OperationStats{Queries: 1, StatementDuration: time.Since(started)}
	if err == nil && !found {
		err = ErrStudentNotFound
	}
	return stats, err
}

func (d participantDirectory) FindStudentNames(ctx context.Context, ids []int64) (map[int64]domain.DailyCandidate, domain.OperationStats, error) {
	started := time.Now()
	rows, err := d.names(ctx, ids)
	names := make(map[int64]domain.DailyCandidate, len(rows))
	for _, row := range rows {
		names[row.StudentID] = domain.DailyCandidate(row)
	}
	return names, domain.OperationStats{Queries: 1, Rows: int64(len(rows)), StatementDuration: time.Since(started)}, err
}

func (d participantDirectory) FindDailyCandidates(ctx context.Context, date domain.Date) ([]domain.DailyCandidate, domain.OperationStats, error) {
	started := time.Now()
	rows, err := d.find(ctx, date.String())
	stats := domain.OperationStats{Queries: 1, StatementDuration: time.Since(started)}
	if err != nil {
		return nil, stats, err
	}
	stats.Rows = int64(len(rows))
	candidates := make([]domain.DailyCandidate, 0, len(rows))
	for _, row := range rows {
		candidates = append(candidates, domain.DailyCandidate{
			StudentID: row.StudentID, FirstName: row.FirstName, LastName: row.LastName, SchoolClass: row.SchoolClass,
		})
	}
	return candidates, stats, nil
}

func (d participantDirectory) FindCandidatesOnDates(ctx context.Context, dates []domain.Date) (map[domain.Date][]domain.DailyCandidate, domain.OperationStats, error) {
	requested := make([]string, 0, len(dates))
	for _, date := range dates {
		requested = append(requested, date.String())
	}
	started := time.Now()
	rows, err := d.days(ctx, requested)
	stats := domain.OperationStats{Queries: 1, StatementDuration: time.Since(started)}
	if err != nil {
		return nil, stats, err
	}
	result := make(map[domain.Date][]domain.DailyCandidate, len(dates))
	for _, date := range dates {
		candidates := make([]domain.DailyCandidate, 0, len(rows[date.String()]))
		for _, row := range rows[date.String()] {
			candidates = append(candidates, domain.DailyCandidate(row))
		}
		result[date] = candidates
		stats.Rows += int64(len(candidates))
	}
	return result, stats, nil
}

// newMealCalendar is the school calendar that also closes the days the
// school cancelled lunch on (#7656), so bookings, kitchen lists, orders and
// the month treat them like closed days, and marks them as cancelled. Both
// reads come from the root, like the rest of the calendar.
func newMealCalendar(find mealplan.CalendarFinder, cancelled mealplan.CancelledDaysFinder) schoolCalendar {
	return schoolCalendar{find: find, cancelled: cancelled}
}

type schoolCalendar struct {
	find      mealplan.CalendarFinder
	cancelled mealplan.CancelledDaysFinder
}

// Days reads the school calendar (two statements: the federal state, the
// closing days with the holiday periods) and the days without lunch (one).
func (c schoolCalendar) Days(ctx context.Context, from, to domain.Date) (domain.CalendarDays, domain.OperationStats, error) {
	started := time.Now()
	closed, periods, err := c.find(ctx, from.String(), to.String())
	stats := domain.OperationStats{Queries: 2, StatementDuration: time.Since(started)}
	if err != nil {
		return domain.CalendarDays{}, stats, err
	}
	var cancelled map[string]bool
	if c.cancelled != nil {
		cancelled, err = c.cancelled(ctx, from.String(), to.String())
		stats.Queries++
		stats.StatementDuration = time.Since(started)
		if err != nil {
			return domain.CalendarDays{}, stats, err
		}
	}
	holidays := make([]domain.HolidayPeriod, 0, len(periods))
	for _, period := range periods {
		start, startErr := calendar.ParseDate(period.Start)
		end, endErr := calendar.ParseDate(period.End)
		if startErr != nil || endErr != nil {
			return domain.CalendarDays{}, stats, fmt.Errorf("meal plan: holiday period %q to %q: %w", period.Start, period.End, errors.Join(startErr, endErr))
		}
		holidays = append(holidays, domain.HolidayPeriod{Start: start, End: end})
	}
	days := domain.NewCalendarDays(closed, holidays, from, to)
	days.Cancelled = make(map[domain.Date]bool, len(cancelled))
	for value := range cancelled {
		date, err := calendar.ParseDate(value)
		if err != nil {
			return domain.CalendarDays{}, stats, err
		}
		if !days.Closed[date] {
			days.Cancelled[date] = true
		}
		days.Closed[date] = true
	}
	return days, stats, nil
}
