package api

// The Essen source of "Heute anders" (ADR 0299, #7666, #7656). The owner is
// Meal Plan: it marks a day whose published menu changed, the change the
// families hear about (#7145), and it holds the days the school cancelled
// lunch on with the school's reason. Every staff account of the school sees
// both, also without meals:read: the entry names no dish and no person. A
// cancelled lunch replaces a changed menu of the same day. The link leads to
// the meal plan page only for an account that may read it (the rule of
// GET /api/meal-plan/days), so nobody lands on a page without content. A day
// without either gives no entry.

import (
	"context"
	"fmt"

	"github.com/moto-ogs/project-phoenix/modules/daychangesview"
	"github.com/moto-ogs/project-phoenix/modules/mealplan"
	mealplanAPI "github.com/moto-ogs/project-phoenix/modules/mealplan/http"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// dayChangesMenuChanges is Meal Plan's read of a day's change mark and
// cancellation, in one statement.
type dayChangesMenuChanges interface {
	MenuDayOn(ctx context.Context, date mealplan.Date) (mealplan.MenuDay, error)
}

// dayChangesMealPlan is the Essen source over Meal Plan's read of the day.
type dayChangesMealPlan struct{ reads dayChangesMenuChanges }

func (s dayChangesMealPlan) MealPlanChanges(ctx context.Context, day calendar.Date) ([]daychangesview.SourceEntry, error) {
	menu, err := s.reads.MenuDayOn(ctx, mealplan.Date(day.String()))
	if err != nil {
		return nil, fmt.Errorf("read meal plan day: %w", err)
	}
	var entry daychangesview.SourceEntry
	switch {
	case menu.Cancelled:
		entry = daychangesview.SourceEntry{Kind: daychangesview.KindMealCancelled, MealCancellation: &daychangesview.DayMealCancellation{Reason: menu.Reason}}
	case menu.Changed:
		entry = daychangesview.SourceEntry{Kind: daychangesview.KindMealPlanChanged}
	default:
		return nil, nil
	}
	if mealPlanAllowed(ctx, mealplanAPI.AccessRead) {
		entry.Link = &daychangesview.Link{Target: daychangesview.LinkMealPlan}
	}
	return []daychangesview.SourceEntry{entry}, nil
}
