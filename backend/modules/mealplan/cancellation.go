package mealplan

import "context"

// MealCancellation is a day on which lunch does not take place although the
// school is open (#7656), for example because the caterer does not deliver.
// Reason is the school's own text. The Meal Plan treats the day like a
// closed day: the bookings of the day lapse, the kitchen list is empty, a
// change of the day is refused with ErrDayClosed and the month does not
// count it. A month already released keeps its counts; the school releases
// it again if needed.
type MealCancellation struct {
	Date   Date
	Reason string
}

// MaxCancellationReason is the longest reason, in characters.
const MaxCancellationReason = 200

// MealCancellations is the school's entry of the days without lunch. Only
// the school enters them (meals:manage); a caterer cannot.
type MealCancellations interface {
	// MealCancellations reads the cancellations of [from, to], at most 42
	// days, by date.
	MealCancellations(ctx context.Context, from, to Date) ([]MealCancellation, error)
	// CancelMeal cancels lunch on a weekday from today on, or replaces the
	// reason of a day already cancelled. A closing day or public holiday is
	// refused with ErrDayClosed, a past day with ErrPastDay.
	CancelMeal(ctx context.Context, cancellation MealCancellation) error
	// RestoreMeal lets lunch take place again from today on: the bookings
	// of the day apply again. A day without a cancellation stays as it is.
	RestoreMeal(ctx context.Context, date Date) error
	// ChildMealCancelledOn reports whether lunch is cancelled on date for a
	// child booked on it (#8160): by the regular days or a day change, as
	// the booking stands without the cancellation and before absences.
	// Without meal registration no child is booked. It reads in the
	// caller's transaction.
	ChildMealCancelledOn(ctx context.Context, studentID int64, date Date) (bool, error)
}

// ErrInvalidMealCancellation refuses a reason that is empty or too long.
var ErrInvalidMealCancellation = &Fault{Code: "invalid_meal_cancellation", Detail: "reason is required and has at most 200 characters"}
