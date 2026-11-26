package postgres

import (
	"context"
	"fmt"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/mealplan/internal/domain"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/uptrace/bun"
)

// Cancellations holds the school's meal cancellations (#7656).
type Cancellations struct{ database Database }

func NewCancellations(database Database) *Cancellations {
	if database == nil {
		panic("meal plan postgres: database runtime is required")
	}
	return &Cancellations{database: database}
}

type cancellationRow struct {
	bun.BaseModel `bun:"table:meal_cancellations,alias:meal_cancellation"`
	TenantID      int64         `bun:"tenant_id"`
	Date          calendar.Date `bun:"date,type:date"`
	Reason        string        `bun:"reason"`
}

func (c *Cancellations) FindCancellations(ctx context.Context, from, to domain.Date) ([]domain.MealCancellation, domain.OperationStats, error) {
	db, tenantID, err := c.database(ctx)
	if err != nil {
		return nil, domain.OperationStats{}, err
	}
	stats := domain.OperationStats{Queries: 1}
	var rows []cancellationRow
	started := time.Now()
	err = db.NewSelect().Model(&rows).
		ModelTableExpr(`schedule.meal_cancellations AS "meal_cancellation"`).
		Where(`"meal_cancellation".tenant_id = ?`, tenantID).
		Where(`"meal_cancellation".date >= ?`, from).
		Where(`"meal_cancellation".date <= ?`, to).
		OrderExpr(`"meal_cancellation".date ASC`).
		Scan(ctx)
	stats.StatementDuration = time.Since(started)
	if err != nil {
		return nil, stats, fmt.Errorf("meal plan postgres: find cancellations: %w", err)
	}
	result := make([]domain.MealCancellation, 0, len(rows))
	for _, value := range rows {
		result = append(result, domain.MealCancellation{Date: value.Date, Reason: value.Reason})
	}
	stats.Rows = int64(len(result))
	return result, stats, nil
}

func (c *Cancellations) SaveCancellation(ctx context.Context, cancellation domain.MealCancellation) (domain.OperationStats, error) {
	db, tenantID, err := c.database(ctx)
	if err != nil {
		return domain.OperationStats{}, err
	}
	value := cancellationRow{TenantID: tenantID, Date: cancellation.Date, Reason: cancellation.Reason}
	stats := domain.OperationStats{Queries: 1}
	started := time.Now()
	_, err = db.NewInsert().Model(&value).
		ModelTableExpr(`schedule.meal_cancellations`).
		On(`CONFLICT (tenant_id, date) DO UPDATE`).
		Set(`reason = EXCLUDED.reason`).
		Exec(ctx)
	stats.StatementDuration = time.Since(started)
	if err != nil {
		return stats, fmt.Errorf("meal plan postgres: save cancellation: %w", err)
	}
	stats.Rows = 1
	return stats, nil
}

func (c *Cancellations) DeleteCancellation(ctx context.Context, date domain.Date) (domain.OperationStats, error) {
	db, tenantID, err := c.database(ctx)
	if err != nil {
		return domain.OperationStats{}, err
	}
	stats := domain.OperationStats{Queries: 1}
	started := time.Now()
	result, err := db.NewDelete().
		TableExpr(`schedule.meal_cancellations AS "meal_cancellation"`).
		Where(`"meal_cancellation".tenant_id = ?`, tenantID).
		Where(`"meal_cancellation".date = ?`, date).
		Exec(ctx)
	stats.StatementDuration = time.Since(started)
	if err != nil {
		return stats, fmt.Errorf("meal plan postgres: delete cancellation: %w", err)
	}
	if affected, affectedErr := result.RowsAffected(); affectedErr == nil {
		stats.Rows = affected
	}
	return stats, nil
}

// CancelledDays reads the days without lunch of a window as a YYYY-MM-DD
// set, for the school calendar the root binds (#7656).
func (m *MenuChanges) CancelledDays(ctx context.Context, from, to string) (map[string]bool, error) {
	start, startErr := calendar.ParseDate(from)
	end, endErr := calendar.ParseDate(to)
	if startErr != nil || endErr != nil {
		return nil, fmt.Errorf("meal plan postgres: cancelled days %q to %q: invalid window", from, to)
	}
	found, _, err := NewCancellations(m.database).FindCancellations(ctx, start, end)
	if err != nil {
		return nil, err
	}
	days := make(map[string]bool, len(found))
	for _, cancellation := range found {
		days[cancellation.Date.String()] = true
	}
	return days, nil
}
