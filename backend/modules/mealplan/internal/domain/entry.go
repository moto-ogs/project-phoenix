package domain

import (
	"time"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

type Date = calendar.Date

func ParseDate(value string) (Date, error) { return calendar.ParseDate(value) }

// DateFromInstant is the Berlin calendar day of an instant.
func DateFromInstant(instant time.Time) Date { return calendar.DateFromTime(instant) }

type Entry struct {
	Date      Date
	Position  int
	Dish      string
	Note      *string
	Allergens []string
	// MenuChangedAt is when the menu of the day changed after it was
	// published (#7666); nil for a day as first published.
	MenuChangedAt *time.Time
}

type OperationStats struct {
	Queries           int64
	Rows              int64
	StatementDuration time.Duration
}
