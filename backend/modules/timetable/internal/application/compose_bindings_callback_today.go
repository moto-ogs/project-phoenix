package application

import (
	"time"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// NewToday is the owner's school day in YYYY-MM-DD: the first given day,
// the Berlin calendar day when none or nil is given.
func NewToday(day ...func() calendar.Date) func() string {
	clock := calendar.TodayDate
	if len(day) > 0 && day[0] != nil {
		clock = day[0]
	}
	return func() string { return clock().String() }
}

// NewClock is the owner's clock from its composition: now, the real clock
// when nil (ADR 0239).
func NewClock(now func() time.Time) func() time.Time {
	if now == nil {
		return time.Now
	}
	return now
}
