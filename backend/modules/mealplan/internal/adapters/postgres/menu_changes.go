package postgres

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/moto-ogs/project-phoenix/modules/mealplan"
	"github.com/moto-ogs/project-phoenix/modules/mealplan/internal/domain"
)

// MenuChanges reads the change mark (#7666) and the cancellation (#7656) of
// a day in one statement.
type MenuChanges struct{ database Database }

func NewMenuChanges(database Database) *MenuChanges {
	if database == nil {
		panic("meal plan postgres: database runtime is required")
	}
	return &MenuChanges{database: database}
}

const menuDaySQL = `SELECT
	EXISTS (SELECT 1 FROM schedule.meal_plan_entries AS meal_plan_entry
		WHERE meal_plan_entry.tenant_id = ? AND meal_plan_entry.date = ? AND meal_plan_entry.menu_changed_at IS NOT NULL) AS changed,
	(SELECT meal_cancellation.reason FROM schedule.meal_cancellations AS meal_cancellation
		WHERE meal_cancellation.tenant_id = ? AND meal_cancellation.date = ?) AS reason`

// MenuDayOn reports whether a dish of the day carries the change mark and
// whether lunch is cancelled on it.
func (m *MenuChanges) MenuDayOn(ctx context.Context, date mealplan.Date) (mealplan.MenuDay, error) {
	day, err := domain.ParseDate(string(date))
	if err != nil {
		return mealplan.MenuDay{}, fmt.Errorf("meal plan postgres: menu day: %w", err)
	}
	db, tenantID, err := m.database(ctx)
	if err != nil {
		return mealplan.MenuDay{}, err
	}
	var result struct {
		Changed bool           `bun:"changed"`
		Reason  sql.NullString `bun:"reason"`
	}
	if err := db.NewRaw(menuDaySQL, tenantID, day, tenantID, day).Scan(ctx, &result); err != nil {
		return mealplan.MenuDay{}, fmt.Errorf("meal plan postgres: read menu day: %w", err)
	}
	return mealplan.MenuDay{Changed: result.Changed, Cancelled: result.Reason.Valid, Reason: result.Reason.String}, nil
}
