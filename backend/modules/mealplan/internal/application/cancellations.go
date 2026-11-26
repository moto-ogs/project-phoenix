package application

import (
	"context"
	"errors"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/moto-ogs/project-phoenix/modules/mealplan"
	"github.com/moto-ogs/project-phoenix/modules/mealplan/internal/domain"
	"github.com/moto-ogs/project-phoenix/modules/mealplan/internal/ports"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// NewWithCancellations composes the Meal Plan like New, over a school
// calendar that also closes the days cancelled finds, and adds the school's
// entry of those days into the cancellation store (#7656).
func NewWithCancellations(store ports.Store, cancellationStore ports.CancellationStore, directory ports.Directory, find mealplan.CalendarFinder, cancelled mealplan.CancelledDaysFinder, settings ports.Settings, tx ports.Transaction, observe ports.Observer, now func() time.Time, notices mealplan.MenuChangeNotices) mealplan.Services {
	if cancellationStore == nil || find == nil {
		panic("meal plan application: the cancellations need their store and the school calendar")
	}
	services := New(store, directory, newMealCalendar(find, cancelled), settings, tx, observe, now, notices)
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

func (c *cancellations) ChildMealCancelledOn(ctx context.Context, studentID int64, value mealplan.Date) (cancelled bool, err error) {
	date, err := calendar.ParseDate(string(value))
	if studentID <= 0 || err != nil {
		return false, mealplan.ErrInvalidMealDate
	}
	err = c.service.run(ctx, "read_child_meal_cancellation", func(txCtx context.Context) (domain.OperationStats, error) {
		// A day without a cancellation, the common case, costs one statement.
		stored, stats, err := c.store.FindCancellations(txCtx, date, date)
		if err != nil || len(stored) == 0 {
			return stats, err
		}
		rules, err := c.service.requireRegistration(txCtx)
		if errors.Is(err, ErrDisabled) || errors.Is(err, ErrRegistrationDisabled) {
			return stats, nil
		}
		if err != nil {
			return stats, err
		}
		days, read, err := c.service.calendar.Days(txCtx, date, date)
		stats = addStats(stats, read)
		if err != nil || !days.Cancelled[date] {
			return stats, err
		}
		// The booking as it stands without the cancellation: the day is
		// open again for the child's regular days and day changes.
		delete(days.Closed, date)
		delete(days.Cancelled, date)
		data, read, err := c.service.store.FindParticipation(txCtx, studentID, date, date)
		stats = addStats(stats, read)
		if err != nil {
			return stats, err
		}
		for _, day := range c.service.resolveParticipation(data, date, date, rules, days, date).Days {
			cancelled = cancelled || (day.Date == date && day.Registered)
		}
		return stats, nil
	})
	return cancelled, mapPublicError(err)
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
