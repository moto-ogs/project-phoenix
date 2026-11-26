package ports

import (
	"context"

	"github.com/moto-ogs/project-phoenix/modules/mealplan/internal/domain"
)

// CancellationStore holds the school's meal cancellations (#7656), one per
// day, in the caller's unit of work.
type CancellationStore interface {
	// FindCancellations reads the cancellations of [from, to] in one
	// statement, by date.
	FindCancellations(ctx context.Context, from, to domain.Date) ([]domain.MealCancellation, domain.OperationStats, error)
	// SaveCancellation cancels lunch on the day or replaces the reason.
	SaveCancellation(ctx context.Context, cancellation domain.MealCancellation) (domain.OperationStats, error)
	// DeleteCancellation lets lunch take place again; a day without one
	// stays as it is.
	DeleteCancellation(ctx context.Context, date domain.Date) (domain.OperationStats, error)
}
