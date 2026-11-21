package api

// The Essen source of "Heute anders" (ADR 0299, #7666). The owner is Meal
// Plan: it marks a day whose published menu changed, the change the families
// hear about (#7145). Every staff account of the school sees that today's
// menu changed, also without meals:read: the entry names no dish. The link
// leads to the meal plan page only for an account that may read it (the rule
// of GET /api/meal-plan/), so nobody lands on a page without content. A day
// without the mark gives no entry.

import (
	"context"
	"fmt"

	"github.com/moto-ogs/project-phoenix/modules/daychangesview"
	"github.com/moto-ogs/project-phoenix/modules/mealplan"
	mealplanAPI "github.com/moto-ogs/project-phoenix/modules/mealplan/http"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// dayChangesMealPlan is the Essen source over Meal Plan's change mark.
type dayChangesMealPlan struct{ reads mealplan.MenuChanges }

func (s dayChangesMealPlan) MealPlanChanges(ctx context.Context, day calendar.Date) ([]daychangesview.SourceEntry, error) {
	changed, err := s.reads.MenuChangedOn(ctx, mealplan.Date(day.String()))
	if err != nil {
		return nil, fmt.Errorf("read meal plan change: %w", err)
	}
	if !changed {
		return nil, nil
	}
	entry := daychangesview.SourceEntry{Kind: daychangesview.KindMealPlanChanged}
	if mealPlanAllowed(ctx, mealplanAPI.AccessRead) {
		entry.Link = &daychangesview.Link{Target: daychangesview.LinkMealPlan}
	}
	return []daychangesview.SourceEntry{entry}, nil
}
