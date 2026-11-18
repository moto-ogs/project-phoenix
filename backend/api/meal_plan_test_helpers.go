//go:build testhooks

package api

import (
	mealplanModule "github.com/moto-ogs/project-phoenix/modules/mealplan"
	mealplanAPI "github.com/moto-ogs/project-phoenix/modules/mealplan/http"
)

// NewMealPlanResourceForTests binds the Meal Plan to the production protected
// HTTP runtime of the staff portal, as the server mounts it at /meal-plan.
func NewMealPlanResourceForTests(module mealplanModule.Capability) *mealplanAPI.Resource {
	return newMealPlanResource(module, newMealPlanExportRenderer())
}
