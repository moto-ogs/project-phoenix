package mealplan

import (
	"context"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// TraegerMealCancellations reads which schools cancelled lunch on a day, for
// "Heute anders" in the Träger-Portal (#8146). The answer carries no reason.
//
// The caller runs it in the administrative transaction of the Träger
// projection; it reads only the given schools. The set holds only schools
// with a cancellation on the day.
type TraegerMealCancellations interface {
	MealCancelledSchools(ctx context.Context, schools []int64, day calendar.Date) (map[int64]bool, error)
}
