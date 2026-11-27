package application

import (
	"context"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/mealplan"
	"github.com/moto-ogs/project-phoenix/modules/mealplan/internal/domain"
	"github.com/moto-ogs/project-phoenix/modules/mealplan/internal/ports"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

type seamStore struct {
	ports.Store
	e *recordingEngine
}

func (s seamStore) ReplaceDay(ctx context.Context, date domain.Date, values []mealplan.Dish, _ *time.Time) (domain.OperationStats, error) {
	dishes := make([]mealplan.Dish, 0, len(values))
	for _, v := range values {
		dishes = append(dishes, mealplan.Dish{Dish: v.Dish, Note: v.Note, Allergens: v.Allergens})
	}
	return domain.OperationStats{}, s.e.Replace(ctx, date.String(), dishes)
}

func (s seamStore) LockDay(_ context.Context, date domain.Date) (domain.OperationStats, error) {
	s.e.calls = append(s.e.calls, "lock "+date.String())
	return domain.OperationStats{}, nil
}

// FindWeek reads the day the engine holds; without one every save in the
// seam is a first publish.
func (s seamStore) FindWeek(_ context.Context, start, _ domain.Date) ([]domain.Entry, domain.OperationStats, error) {
	s.e.calls = append(s.e.calls, "read "+start.String())
	return s.e.stored, domain.OperationStats{}, nil
}

type seamTransaction struct{}

func (seamTransaction) Run(ctx context.Context, fn func(context.Context) error) error { return fn(ctx) }

type seamSettings struct{ e *recordingEngine }

func (s seamSettings) MealPlanEnabled(context.Context) (bool, error)       { return s.e.available, nil }
func (seamSettings) MealRegistrationEnabled(context.Context) (bool, error) { return true, nil }
func (seamSettings) MealOrderingSettings(context.Context) (ports.OrderingSettings, error) {
	return ports.OrderingSettings{}, nil
}
func newTestModule(e *recordingEngine) mealplan.Capability {
	return New(seamStore{e: e}, struct{ ports.Directory }{}, struct{ ports.Calendar }{}, seamSettings{e}, seamTransaction{}, func(ports.Observation) {}, func() time.Time { return time.Date(2026, 9, 7, 8, 0, 0, 0, calendar.Berlin) }, nil).Capability
}
