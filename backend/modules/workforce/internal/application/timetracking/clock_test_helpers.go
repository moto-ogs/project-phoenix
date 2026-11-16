//go:build testhooks

package timetracking

import (
	"time"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// Behaviour tests pin the absence and month services' clocks through these options.

// WithAbsenceToday overrides the absence service's calendar-day clock.
func WithAbsenceToday(today func() calendar.Date) StaffAbsenceOption {
	return func(s *staffAbsenceService) { s.todayFunc = today }
}

// WithMonthClock overrides the month service's clock and its calendar day.
func WithMonthClock(now func() time.Time) WorkTimeMonthOption {
	return func(s *workTimeMonthService) { s.nowFunc = now }
}
