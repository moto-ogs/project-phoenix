package application

import (
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// NewToday is the owner's school day in YYYY-MM-DD: the first given day,
// the Berlin calendar day when none or nil is given.
func NewToday(day ...func() calendar.Date) func() string {
	if len(day) > 0 && day[0] != nil {
		return func() string { return day[0]().String() }
	}
	return func() string { return calendar.TodayDate().String() }
}
