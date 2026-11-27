package postgres

import (
	"context"
	"errors"
	"fmt"

	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/pgdialect"

	"github.com/moto-ogs/project-phoenix/modules/mealplan"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

var _ mealplan.TraegerMealCancellations = (*MenuChanges)(nil)

// traegerMealCancellationsSQL reads the schools of the set that cancelled
// lunch on the day, without the reason. The filter on the school set is the
// boundary: the administrative transaction has no row security.
const traegerMealCancellationsSQL = `SELECT tenant_id FROM schedule.meal_cancellations
WHERE tenant_id = ANY(?0) AND date = ?1`

// MealCancelledSchools reads the schools of the set that cancelled lunch on
// the day (#8146), only in the administrative transaction of the Träger
// projection.
func (s *MenuChanges) MealCancelledSchools(ctx context.Context, schools []int64, day calendar.Date) (map[int64]bool, error) {
	result := map[int64]bool{}
	if len(schools) == 0 {
		return result, nil
	}
	transaction, ok := s.transaction(ctx)
	if !ok {
		return nil, errors.New("meal plan postgres: transaction is required")
	}
	if !s.admin(ctx) {
		return nil, errors.New("meal plan postgres: the meal cancellations of a Träger need the administrative transaction")
	}
	var db bun.IDB
	switch tx := transaction.(type) {
	case bun.Tx:
		db = tx
	case *bun.Tx:
		if tx != nil {
			db = *tx
		}
	}
	if db == nil {
		return nil, fmt.Errorf("meal plan postgres: unsupported transaction %T", transaction)
	}
	var tenants []int64
	if err := db.NewRaw(traegerMealCancellationsSQL, pgdialect.Array(schools), day).Scan(ctx, &tenants); err != nil {
		return nil, fmt.Errorf("meal plan postgres: meal cancellations of a Träger: %w", err)
	}
	for _, tenantID := range tenants {
		result[tenantID] = true
	}
	return result, nil
}
