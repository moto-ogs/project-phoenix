package domain

// MealCancellation is a day on which lunch does not take place although the
// school is open (#7656), with the school's reason. The Meal Plan treats the
// day like a closed day.
type MealCancellation struct {
	Date   Date
	Reason string
}
