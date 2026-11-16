package application

import (
	"context"
	"fmt"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/mealplan"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

type ParticipationHistoryStore interface {
	InsertParticipationHistory(context.Context, []mealplan.PastMealDay) error
}

// ParticipationHistory writes past meal days; only days before today, the
// Berlin day of its clock (ADR 0239), count as past.
type ParticipationHistory struct {
	store ParticipationHistoryStore
	tx    interface {
		Run(context.Context, func(context.Context) error) error
	}
	today func() calendar.Date
}

func NewParticipationHistory(store ParticipationHistoryStore, tx interface {
	Run(context.Context, func(context.Context) error) error
}, now func() time.Time) *ParticipationHistory {
	if now == nil {
		panic("meal plan: participation history requires its clock")
	}
	return &ParticipationHistory{store: store, tx: tx, today: calendar.CalendarDateClock(now)}
}

func (h *ParticipationHistory) RecordParticipationHistory(ctx context.Context, days []mealplan.PastMealDay) error {
	today := h.today()
	for _, day := range days {
		parsed, err := calendar.ParseDate(day.Date.String())
		if err != nil || day.StudentID <= 0 || !parsed.Before(today) || calendar.IsWeekend(parsed) {
			return fmt.Errorf("meal plan: invalid past meal day")
		}
	}
	if len(days) == 0 {
		return nil
	}
	return h.tx.Run(ctx, func(ctx context.Context) error { return h.store.InsertParticipationHistory(ctx, days) })
}
