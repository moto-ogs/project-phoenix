package migrations

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"github.com/uptrace/bun"
)

const mealPlanMenuChangedAtVersion = "20261121090352"

func init() {
	MigrationRegistry.Register(&Migration{
		Version:     mealPlanMenuChangedAtVersion,
		Description: "Speiseplan: wann das Menü eines Tages geändert wurde (#7666)",
		DependsOn:   []string{mealPlanAllergensVersion}, // "1.15.497": the last change of the table it alters
	})
	Migrations.MustRegister(mealPlanMenuChangedAtUp, mealPlanMenuChangedAtDown)
}

// mealPlanMenuChangedAtUpSQL marks the dishes of a day whose menu changed
// after it was published (#7666), the change the families hear about (#7145).
// Staff read the mark as „Speiseplan heute geändert“; the content stays on
// the meal plan page. Existing days stay unmarked: no change was recorded.
const mealPlanMenuChangedAtUpSQL = `
	ALTER TABLE schedule.meal_plan_entries
		ADD COLUMN IF NOT EXISTS menu_changed_at TIMESTAMPTZ;
`

const mealPlanMenuChangedAtDownSQL = `
	ALTER TABLE schedule.meal_plan_entries DROP COLUMN IF EXISTS menu_changed_at;
`

func mealPlanMenuChangedAtUp(ctx context.Context, db *bun.DB) error {
	tx, err := db.BeginTx(ctx, &sql.TxOptions{})
	if err != nil {
		return fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer rollbackMealPlanMenuChangedAt(ctx, tx)
	if _, err := tx.ExecContext(ctx, mealPlanMenuChangedAtUpSQL); err != nil {
		return fmt.Errorf("add meal plan menu change mark: %w", err)
	}
	return tx.Commit()
}

func mealPlanMenuChangedAtDown(ctx context.Context, db *bun.DB) error {
	tx, err := db.BeginTx(ctx, &sql.TxOptions{})
	if err != nil {
		return fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer rollbackMealPlanMenuChangedAt(ctx, tx)
	if _, err := tx.ExecContext(ctx, mealPlanMenuChangedAtDownSQL); err != nil {
		return fmt.Errorf("drop meal plan menu change mark: %w", err)
	}
	return tx.Commit()
}

func rollbackMealPlanMenuChangedAt(ctx context.Context, tx bun.Tx) {
	if err := tx.Rollback(); err != nil && !errors.Is(err, sql.ErrTxDone) {
		logRollbackFailure(ctx, err)
	}
}
