package application

import (
	"context"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/moto-ogs/project-phoenix/modules/mealplan"
	"github.com/moto-ogs/project-phoenix/modules/mealplan/internal/domain"
	"github.com/moto-ogs/project-phoenix/modules/mealplan/internal/ports"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// NewWithCancellations composes the Meal Plan like New, over a school
// calendar that closes the days in the cancellation store, and adds the
// school's entry of those days (#7656).
func NewWithCancellations(store ports.Store, cancellationStore ports.CancellationStore, directory ports.Directory, find mealplan.CalendarFinder, settings ports.Settings, tx ports.Transaction, observe ports.Observer, now func() time.Time, notices mealplan.MenuChangeNotices) mealplan.Services {
	if cancellationStore == nil || find == nil {
		panic("meal plan application: the cancellations need their store and the school calendar")
	}
	services := New(store, directory, newMealCalendar(find, cancellationStore), settings, tx, observe, now, notices)
	services.Cancellations = &cancellations{service: services.Capability.(*Service), store: cancellationStore}
	return services
}

type cancellations struct {
	service *Service
	store   ports.CancellationStore
}

func (c *cancellations) MealCancellations(ctx context.Context, from, to mealplan.Date) (result []mealplan.MealCancellation, err error) {
	start, end, err := readWindow(from, to)
	if err != nil {
		return nil, err
	}
	err = c.service.run(ctx, "read_cancellations", func(txCtx context.Context) (domain.OperationStats, error) {
		if err := c.service.requireEnabled(txCtx); err != nil {
			return domain.OperationStats{}, err
		}
		stored, stats, err := c.store.FindCancellations(txCtx, start, end)
		result = make([]mealplan.MealCancellation, 0, len(stored))
		for _, cancellation := range stored {
			result = append(result, mealplan.MealCancellation{Date: mealplan.Date(cancellation.Date.String()), Reason: cancellation.Reason})
		}
		return stats, err
	})
	return result, mapPublicError(err)
}

func (c *cancellations) CancelMeal(ctx context.Context, command mealplan.MealCancellation) error {
	date, err := cancellationDate(command.Date)
	if err != nil {
		return err
	}
	reason := strings.TrimSpace(command.Reason)
	if reason == "" || utf8.RuneCountInString(reason) > mealplan.MaxCancellationReason {
		return mealplan.ErrInvalidMealCancellation
	}
	return mapPublicError(c.service.run(ctx, "cancel_meal", func(txCtx context.Context) (domain.OperationStats, error) {
		stats, err := c.requireOpenDay(txCtx, date)
		if err != nil {
			return stats, err
		}
		saved, err := c.store.SaveCancellation(txCtx, domain.MealCancellation{Date: date, Reason: reason})
		return addStats(stats, saved), err
	}))
}

func (c *cancellations) RestoreMeal(ctx context.Context, value mealplan.Date) error {
	date, err := cancellationDate(value)
	if err != nil {
		return err
	}
	return mapPublicError(c.service.run(ctx, "restore_meal", func(txCtx context.Context) (domain.OperationStats, error) {
		if err := c.service.requireEnabled(txCtx); err != nil {
			return domain.OperationStats{}, err
		}
		if date.Before(domain.DateFromInstant(c.service.now())) {
			return domain.OperationStats{}, ErrPastDay
		}
		return c.store.DeleteCancellation(txCtx, date)
	}))
}

// requireOpenDay checks that lunch can be cancelled on the day: the meal
// plan is on, the day is not over, and the school is open. A day already
// cancelled is open for a new reason.
func (c *cancellations) requireOpenDay(ctx context.Context, date domain.Date) (domain.OperationStats, error) {
	if err := c.service.requireEnabled(ctx); err != nil {
		return domain.OperationStats{}, err
	}
	if date.Before(domain.DateFromInstant(c.service.now())) {
		return domain.OperationStats{}, ErrPastDay
	}
	days, stats, err := c.service.calendar.Days(ctx, date, date)
	if err != nil {
		return stats, err
	}
	if days.Closed[date] && !days.Cancelled[date] {
		return stats, ErrDayClosed
	}
	return stats, nil
}

// cancellationDate parses the day of a cancellation: a weekday.
func cancellationDate(value mealplan.Date) (domain.Date, error) {
	date, err := calendar.ParseDate(string(value))
	if err != nil || date.Weekday() == time.Saturday || date.Weekday() == time.Sunday {
		return "", mealplan.ErrInvalidMealDate
	}
	return date, nil
}
