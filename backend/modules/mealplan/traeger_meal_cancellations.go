package mealplan

import (
	"context"
	"errors"

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

// ErrNoTraegerMealCancellations reports menu changes without the Träger read.
var ErrNoTraegerMealCancellations = errors.New("meal plan: the menu changes read no meal cancellations of a Träger")

// TraegerMealCancellationsOf is the read of the Träger's schools without
// lunch the menu changes composed; they read the same table.
func TraegerMealCancellationsOf(changes MenuChanges) (TraegerMealCancellations, error) {
	read, ok := changes.(TraegerMealCancellations)
	if !ok {
		return nil, ErrNoTraegerMealCancellations
	}
	return read, nil
}
