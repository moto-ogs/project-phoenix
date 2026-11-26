package mealplan

import "context"

type ParticipantCandidate struct {
	StudentID   int64
	FirstName   string
	LastName    string
	SchoolClass string
}

type ParticipantFinder func(context.Context, string) ([]ParticipantCandidate, error)

// ParticipantDaysFinder reads each requested day in the caller's tenant unit.
// A failure is retried through ParticipantFinder at the original daily boundary.
type ParticipantDaysFinder func(context.Context, []string) (map[string][]ParticipantCandidate, error)

// StudentNameFinder names children by ID, enrolled or not, for past orders.
type StudentNameFinder func(context.Context, []int64) ([]ParticipantCandidate, error)

// StudentLock takes the child's student row FOR NO KEY UPDATE in the
// caller's tenant transaction, as the parent portal's child guard holds it
// for a meal write already. Every write of a child's meal participation
// takes it before its own locks, so the school's writes cannot deadlock
// against a parent's (lock order student → schedule → orders). The mode
// lets the holder of the order lock (the worker, another child's write)
// insert order lines and changes of the child, whose foreign key takes a
// key share on the row, while the write waits for that lock. It reports
// false when the school has no such child.
type StudentLock func(context.Context, int64) (bool, error)

// HolidayPeriod is one school holiday period as the school calendar keeps
// it: YYYY-MM-DD dates, both ends inclusive.
type HolidayPeriod struct {
	Start string
	End   string
}

// CalendarFinder reads the school calendar for the inclusive window
// [from, to]: the closed days (closing days, public holidays) as a
// YYYY-MM-DD set and the school holiday periods that touch the window. The
// Meal Plan turns the periods into days itself.
type CalendarFinder func(ctx context.Context, from, to string) (closed map[string]bool, holidays []HolidayPeriod, err error)

// CancelledDaysFinder reads the days of the inclusive window [from, to] on
// which the school cancelled lunch (#7656) as a YYYY-MM-DD set. The root
// binds it beside CalendarFinder, as part of the school calendar the Meal
// Plan reads: those days count as closed, marked as cancelled.
type CancelledDaysFinder func(ctx context.Context, from, to string) (map[string]bool, error)
