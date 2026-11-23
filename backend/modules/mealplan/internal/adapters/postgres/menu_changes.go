package postgres

import (
	"context"
	"fmt"

	"github.com/moto-ogs/project-phoenix/modules/mealplan"
	"github.com/moto-ogs/project-phoenix/modules/mealplan/internal/domain"
)

// MenuChanges reads the change mark of a day (#7666) in one statement.
type MenuChanges struct{ database Database }

func NewMenuChanges(database Database) *MenuChanges {
	if database == nil {
		panic("meal plan postgres: database runtime is required")
	}
	return &MenuChanges{database: database}
}

// MenuChangedOn reports whether a dish of the day carries the change mark.
func (m *MenuChanges) MenuChangedOn(ctx context.Context, date mealplan.Date) (bool, error) {
	day, err := domain.ParseDate(string(date))
	if err != nil {
		return false, fmt.Errorf("meal plan postgres: menu change day: %w", err)
	}
	db, tenantID, err := m.database(ctx)
	if err != nil {
		return false, err
	}
	changed, err := db.NewSelect().Model((*row)(nil)).
		ModelTableExpr(`schedule.meal_plan_entries AS "meal_plan_entry"`).
		Where(`"meal_plan_entry".tenant_id = ?`, tenantID).
		Where(`"meal_plan_entry".date = ?`, day).
		Where(`"meal_plan_entry".menu_changed_at IS NOT NULL`).
		Exists(ctx)
	if err != nil {
		return false, fmt.Errorf("meal plan postgres: read menu change: %w", err)
	}
	return changed, nil
}
