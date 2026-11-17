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

// The services read the clock of their composition and have no wall-clock
// fallback (ADR 0272). Tests that build a service directly hand it a clock
// through these options; each keeps a clock an earlier option already set.

// WithSessionClock sets the work session service's clock.
func WithSessionClock(now func() time.Time) WorkSessionOption {
	return func(s *workSessionService) {
		if s.nowFunc == nil {
			s.nowFunc = now
		}
	}
}

// WithMonthTestClock sets the month service's clock unless one is set.
func WithMonthTestClock(now func() time.Time) WorkTimeMonthOption {
	return func(s *workTimeMonthService) {
		if s.nowFunc == nil {
			s.nowFunc = now
		}
	}
}

// WithAbsenceClock sets the absence service's clock.
func WithAbsenceClock(now func() time.Time) StaffAbsenceOption {
	return func(s *staffAbsenceService) {
		if s.nowFunc == nil {
			s.nowFunc = now
		}
	}
}

// WithAdjustmentClock sets the balance adjustment service's clock.
func WithAdjustmentClock(now func() time.Time) StaffBalanceAdjustmentOption {
	return func(s *staffBalanceAdjustmentService) {
		if s.nowFunc == nil {
			s.nowFunc = now
		}
	}
}

// WithMonthCloseClock sets the month close's clock.
func WithMonthCloseClock(now func() time.Time) StaffMonthCloseOption {
	return func(s *staffMonthCloseService) {
		if s.now == nil {
			s.now = now
		}
	}
}

// WithOverviewClock sets the overview service's clock.
func WithOverviewClock(now func() time.Time) StaffOverviewOption {
	return func(s *staffOverviewService) {
		if s.nowFunc == nil {
			s.nowFunc = now
		}
	}
}
