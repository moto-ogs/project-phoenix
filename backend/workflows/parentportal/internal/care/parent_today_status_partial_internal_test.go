package care

import (
	"context"
	"errors"
	"log/slog"
	"testing"
	"time"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// exceptionThenFailingPlan answers one child's day exception and fails the
// weekly plan read for the others.
type exceptionThenFailingPlan struct {
	ArrivalSchedules
	exceptionFor int64
}

func (a exceptionThenFailingPlan) GetStudentArrivalExceptionsForDate(_ context.Context, _ []int64, date calendar.Date) (map[int64]*ArrivalException, error) {
	arrival := time.Date(0, 1, 1, 9, 0, 0, 0, time.UTC)
	return map[int64]*ArrivalException{a.exceptionFor: {StudentID: a.exceptionFor, ExceptionDate: date, ExpectedArrival: &arrival}}, nil
}

func (exceptionThenFailingPlan) GetWeeklySchedulesByStudentIDsAndWeekday(context.Context, []int64, int) ([]*ArrivalSchedule, error) {
	return nil, errors.New("weekly plan unavailable")
}

// A sibling's failed weekly plan read must not erase a day exception the
// set read already confirmed; only the unread child stays unresolved.
func TestLoadTodayPlanKeepsConfirmedExceptionWhenSiblingPlanFails(t *testing.T) {
	t.Parallel()

	svc := &Service{Config: Config{ArrivalSchedules: exceptionThenFailingPlan{exceptionFor: 7}, Logger: slog.Default()}}
	ctx := calendar.WithWeekendPlan(context.Background(), func(context.Context) (bool, error) { return false, nil })
	monday := calendar.NewDate(2026, time.August, 31)
	facts := map[int64]*todayStatusFacts{7: {}, 8: {}}

	svc.loadTodayPlan(ctx, []int64{7, 8}, monday, facts)

	if got := facts[7]; !got.CareDayResolved || !got.IsCareDay || got.ExpectedArrival != "09:00" {
		t.Fatalf("the confirmed exception is lost: %+v", got)
	}
	if got := facts[8]; got.CareDayResolved {
		t.Fatalf("an unread weekly plan must stay unresolved: %+v", got)
	}
}
