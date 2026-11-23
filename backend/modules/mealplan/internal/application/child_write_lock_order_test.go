package application

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/modules/mealplan"
	"github.com/moto-ogs/project-phoenix/modules/mealplan/internal/domain"
	"github.com/moto-ogs/project-phoenix/modules/mealplan/internal/ports"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// errStopAfterLock ends a write at its second lock: the test only records
// the order in which the write takes its locks.
var errStopAfterLock = errors.New("stop after the lock")

type lockOrder struct{ calls []string }

type lockOrderStore struct {
	ports.Store
	order *lockOrder
}

func (s lockOrderStore) LockSchedule(context.Context, int64) (domain.OperationStats, error) {
	s.order.calls = append(s.order.calls, "schedule")
	return domain.OperationStats{}, errStopAfterLock
}

func (s lockOrderStore) LockOrders(context.Context) (domain.OperationStats, error) {
	s.order.calls = append(s.order.calls, "orders")
	return domain.OperationStats{}, errStopAfterLock
}

func (lockOrderStore) FindParticipation(context.Context, int64, domain.Date, domain.Date) (domain.ParticipationData, domain.OperationStats, error) {
	return domain.ParticipationData{}, domain.OperationStats{}, nil
}

type lockOrderDirectory struct {
	ports.Directory
	order *lockOrder
}

func (d lockOrderDirectory) LockStudent(context.Context, int64) (domain.OperationStats, error) {
	d.order.calls = append(d.order.calls, "student")
	return domain.OperationStats{}, nil
}

func (lockOrderDirectory) FindDailyCandidates(context.Context, domain.Date) ([]domain.DailyCandidate, domain.OperationStats, error) {
	return []domain.DailyCandidate{{StudentID: 7}}, domain.OperationStats{}, nil
}

type lockOrderCalendar struct{}

func (lockOrderCalendar) Days(context.Context, domain.Date, domain.Date) (domain.CalendarDays, domain.OperationStats, error) {
	return domain.CalendarDays{}, domain.OperationStats{}, nil
}

type registrationSettings struct{}

func (registrationSettings) MealPlanEnabled(context.Context) (bool, error)         { return true, nil }
func (registrationSettings) MealRegistrationEnabled(context.Context) (bool, error) { return true, nil }
func (registrationSettings) MealOrderingSettings(context.Context) (ports.OrderingSettings, error) {
	return ports.OrderingSettings{
		Model: "ongoing_single", RegistrationKind: "days_before", RegistrationWeekday: "thursday", RegistrationTime: "09:00",
		CancellationKind: "days_before", CancellationWeekday: "thursday", CancellationTime: "09:00",
		AnnualChanges: "parents_cancel", SickAfterDeadline: "stays_ordered", OrderRhythm: "daily", OrderDetail: "by_class",
	}, nil
}

// The parent portal's child guard holds the student row FOR UPDATE before
// the Meal Plan takes its schedule and order locks. A school write that
// took those locks first and the student row's key share with its insert
// afterwards deadlocked against a parent's write of the same child. Every
// write of a child's participation takes the student row first.
func TestChildWritesTakeTheStudentRowFirst(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 9, 7, 8, 0, 0, 0, calendar.Berlin)
	writes := map[string]func(*Service) error{
		"school schedule": func(s *Service) error {
			_, err := s.ReplaceScheduleBySchool(context.Background(), mealplan.SchoolSchedule{StudentID: 7, StaffAccountID: 3, Weekdays: []mealplan.Weekday{mealplan.Monday}, EffectiveFrom: "2026-09-14", ExpectedVersion: "v"})
			return err
		},
		"school day": func(s *Service) error {
			return s.SetParticipationBySchool(context.Background(), mealplan.SchoolChange{StudentID: 7, StaffAccountID: 3, Date: "2026-09-14", Participating: true})
		},
		"school day cleared": func(s *Service) error {
			return s.ClearParticipationBySchool(context.Background(), mealplan.SchoolChange{StudentID: 7, StaffAccountID: 3, Date: "2026-09-14"})
		},
		"parent schedule": func(s *Service) error {
			_, err := s.ReplaceParticipationSchedule(context.Background(), mealplan.ReplaceParticipationSchedule{StudentID: 7, GuardianAccountID: 3, Weekdays: []mealplan.Weekday{mealplan.Monday}, ExpectedVersion: "v"})
			return err
		},
	}
	for name, write := range writes {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			order := &lockOrder{}
			service := New(lockOrderStore{order: order}, lockOrderDirectory{order: order}, lockOrderCalendar{}, registrationSettings{}, seamTransaction{}, func(ports.Observation) {}, func() time.Time { return now }, nil)
			require.Error(t, write(service))
			require.GreaterOrEqual(t, len(order.calls), 2, "the write reaches its own lock")
			assert.Equal(t, "student", order.calls[0], "the student row comes before the meal plan's locks")
		})
	}
}
