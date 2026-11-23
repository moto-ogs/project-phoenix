package application

import (
	"context"
	"errors"
	"fmt"
	"slices"

	"github.com/moto-ogs/project-phoenix/modules/mealplan"
	"github.com/moto-ogs/project-phoenix/modules/mealplan/internal/domain"
)

// menuChangePushDays is how far ahead a changed meal plan day may lie and
// still ring a phone, the relevance window of the notification feed (#7127):
// a later one reaches the feed only.
const menuChangePushDays = 14

// noticeMenuChange tells the families with a meal booked on the day that its
// menu changed (#7145), in the unit of work that changed it. Only a day that
// already had a menu changes: publishing the menu of an empty day is the
// regular weekly plan, not a change. A day already over and a save that
// leaves the menu as it was tell nobody, and so does a school without meal
// registration, where no child has a meal booked.
func (s *Service) noticeMenuChange(txCtx context.Context, date domain.Date, before []domain.Entry, after []mealplan.Dish, actorAccountID int64) (domain.OperationStats, error) {
	if s.notices == nil || len(before) == 0 || dayVersion(storedDishes(before)) == dayVersion(after) {
		return domain.OperationStats{}, nil
	}
	today := domain.DateFromInstant(s.now())
	if date.Before(today) {
		return domain.OperationStats{}, nil
	}
	booked, stats, err := s.bookedOn(txCtx, date)
	if err != nil || len(booked) == 0 {
		return stats, err
	}
	change := mealplan.MenuChange{
		Date: mealplan.Date(date.String()), WeekStart: mealplan.Date(date.StartOfISOWeek().String()),
		StudentIDs: booked, ActorAccountID: actorAccountID,
		Push: today.DaysUntil(date) <= menuChangePushDays,
	}
	if err := s.notices.NotifyMenuChanged(txCtx, change); err != nil {
		return stats, fmt.Errorf("meal plan: notify menu change: %w", err)
	}
	return stats, nil
}

// bookedOn lists the children with a meal booked on the day: the children the
// daily list counts as eating, after absences. Without meal registration no
// child has a meal booked.
func (s *Service) bookedOn(txCtx context.Context, date domain.Date) ([]int64, domain.OperationStats, error) {
	rules, err := s.requireRegistration(txCtx)
	if errors.Is(err, ErrRegistrationDisabled) {
		return nil, domain.OperationStats{}, nil
	}
	if err != nil {
		return nil, domain.OperationStats{}, err
	}
	list, _, stats, err := s.dailyListIn(txCtx, rules, date, date, nil)
	if err != nil {
		return nil, stats, err
	}
	booked := make([]int64, 0, len(list.Participants))
	for _, participant := range list.Participants {
		booked = append(booked, participant.StudentID)
	}
	slices.Sort(booked)
	return slices.Compact(booked), stats, nil
}
