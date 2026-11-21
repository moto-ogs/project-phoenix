package api

// The Essen source of "Heute anders" (ADR 0299, #7666). The owner is Meal
// Plan: it marks a day whose published menu changed, the change the families
// hear about (#7145). Every staff account of the school sees that today's
// menu changed, also without meals:read: the entry names no dish, and the
// meal plan page shows the menu only with its own permission. A day without
// the mark gives no entry.

import (
	"context"
	"fmt"

	"github.com/moto-ogs/project-phoenix/modules/daychangesview"
	"github.com/moto-ogs/project-phoenix/modules/mealplan"
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
	return []daychangesview.SourceEntry{{
		Kind: daychangesview.KindMealPlanChanged,
		Link: &daychangesview.Link{Target: daychangesview.LinkMealPlan},
	}}, nil
}
