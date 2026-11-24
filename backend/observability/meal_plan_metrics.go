package observability

import (
	"time"

	"github.com/moto-ogs/project-phoenix/sharedkernel/readstate"
)

// ObserveMealPlanOperation records one Meal Plan operation: outcome and
// stable code, duration, query count, changed rows and statement duration.
func ObserveMealPlanOperation(operation string, duration time.Duration, queries, rows int64, statementDuration time.Duration, codeLabel string, err error) {
	outcome := "success"
	if err == nil {
		codeLabel = "none"
	} else {
		outcome, codeLabel = "error", readstate.OperationCode(codeLabel, err)
	}
	mealPlanOperations.WithLabelValues(operation, outcome, sanitizeLabel(codeLabel)).Inc()
	mealPlanDuration.WithLabelValues(operation).Observe(duration.Seconds())
	if queries > 0 {
		mealPlanQueries.WithLabelValues(operation).Add(float64(queries))
	}
	if rows > 0 {
		mealPlanRowsChanged.WithLabelValues(operation).Add(float64(rows))
	}
	if statementDuration > 0 {
		mealPlanStatementDuration.WithLabelValues(operation).Observe(statementDuration.Seconds())
	}
}
