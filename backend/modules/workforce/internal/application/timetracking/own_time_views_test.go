package timetracking

import (
	"bytes"
	"context"
	"errors"
	"log/slog"
	"testing"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/workforce"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/tenant"
	"github.com/stretchr/testify/require"
)

type unavailableOwnTimeShifts struct{}

func (unavailableOwnTimeShifts) ListShifts(context.Context, workforce.ShiftRange) ([]workforce.PlannedShift, error) {
	return nil, errors.New("shift read failed")
}

func TestOwnClockAdvanceUsesAccountStartMonthBoundary(t *testing.T) {
	t.Parallel()
	anchor := calendar.NewDate(2026, time.June, 10)
	for _, tc := range []struct {
		today calendar.Date
		want  bool
	}{
		{calendar.NewDate(2026, time.May, 29), true},
		{calendar.NewDate(2026, time.June, 9), false},
		{anchor, true},
	} {
		facts := ownTimeFacts{now: tc.today.BerlinMidnight(), today: tc.today, targets: &dailyTargetResolver{}}
		projected := facts.projectClock(wtmStaffID, nil, nil, ownChartDays(tc.today), anchor, &MonthSummary{})
		require.Equal(t, tc.want, projected.TodayCountsInTotals, "%s", tc.today)
	}
}

func TestOwnMonthSummaryDoesNotReportAnUnavailableShiftPlanAsEmpty(t *testing.T) {
	t.Parallel()
	var log bytes.Buffer
	var operations []tenant.SavepointAction
	unit, err := tenant.NewUnitOfWork(
		func(ctx context.Context, _ int64, run func(context.Context, any) error) error {
			return run(ctx, struct{}{})
		},
		func(ctx context.Context, run func(context.Context, any) error) error { return run(ctx, struct{}{}) },
		func(_ context.Context, action tenant.SavepointAction) error {
			operations = append(operations, action)
			return nil
		},
		func(error) bool { return false },
	)
	require.NoError(t, err)
	ctx := tenant.WithUnitOfWork(t.Context(), unit)
	months := newWTMFixture().svc
	months.logger = slog.New(slog.NewTextHandler(&log, nil))
	views := ownTimeViews{
		months: months, absences: &staffAbsenceService{},
		planning: workforce.OwnTimeViewPlanning{
			Shifts:       unavailableOwnTimeShifts{},
			ShiftsBooked: func(context.Context) (bool, error) { return true, nil },
		},
	}
	first := calendar.NewDate(2026, time.June, 1)
	key := monthOf(first)
	facts := ownTimeFacts{now: wtmNow(), today: calendar.DateFromTime(wtmNow()), targets: &dailyTargetResolver{}}
	period, err := views.projectPeriod(ctx, wtmStaffID, workforce.OwnTimeMonth, first, key.lastDay(),
		first, key.lastDay().StartOfISOWeek().AddDays(6), first, facts, ownCalendar{}, carryChain{first: first, key: key})
	require.NoError(t, err)
	require.Equal(t, workforce.OwnReadUnavailable, period.Shifts.State)
	require.NotNil(t, period.MonthSummary)
	require.Equal(t, workforce.OwnReadUnavailable, period.MonthSummary.PlannedShiftState)
	require.Nil(t, period.MonthSummary.PlannedShiftMinutes)
	require.Equal(t, []tenant.SavepointAction{tenant.CreateSavepoint, tenant.RollbackSavepoint, tenant.ReleaseSavepoint}, operations)
	require.Contains(t, log.String(), "part=shifts")
	require.Contains(t, log.String(), "shift read failed")
}
