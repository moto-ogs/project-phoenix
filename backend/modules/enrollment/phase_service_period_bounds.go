package enrollment

import (
	"fmt"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// Upper bounds of a phase's service period (#5658). Checks that project
// bookings day by day up to a date inside the service period run longer the
// further its end lies, and they hold transaction locks meanwhile.
const (
	// MaxServicePeriodYears bounds the service period from its start to its
	// end, the same for every phase kind.
	MaxServicePeriodYears = 2
	// MaxServiceEndYearsAhead bounds how far the service end may lie after
	// the school's today.
	MaxServiceEndYearsAhead = 5
)

// ValidateServicePeriodBounds rejects a service period longer than
// MaxServicePeriodYears or ending more than MaxServiceEndYearsAhead after
// today, the school's calendar day. An end exactly on the bound passes.
//
// It applies when a phase is created and when its service period changes. A
// stored phase beyond the bounds stays valid as long as its period stays as it
// is, so Phase.Validate does not run it: the store re-validates unchanged rows.
func ValidateServicePeriodBounds(start, end Date, today calendar.Date) error {
	startDay, err := calendar.ParseDate(string(start))
	if err != nil {
		return invalidInput(CodePhaseServicePeriodInvalid, "service_start_date", fmt.Errorf("service_start_date: %w", err))
	}
	endDay, err := calendar.ParseDate(string(end))
	if err != nil {
		return invalidInput(CodePhaseServicePeriodInvalid, "service_end_date", fmt.Errorf("service_end_date: %w", err))
	}
	if latest := addYears(startDay, MaxServicePeriodYears); endDay.After(latest) {
		return invalidInputf(CodePhaseServicePeriodTooLong, "service_end_date",
			"service_end_date %s is more than %d years after service_start_date %s (latest %s)",
			endDay, MaxServicePeriodYears, startDay, latest)
	}
	if latest := addYears(today, MaxServiceEndYearsAhead); endDay.After(latest) {
		return invalidInputf(CodePhaseServiceEndTooFar, "service_end_date",
			"service_end_date %s is more than %d years after today %s (latest %s)",
			endDay, MaxServiceEndYearsAhead, today, latest)
	}
	return nil
}

// ServicePeriodChanged reports whether the update moves the stored service
// period, the edit at which ValidateServicePeriodBounds applies.
func ServicePeriodChanged(storedStart, storedEnd, start, end Date) bool {
	return storedStart != start || storedEnd != end
}

// addYears moves d by years on the calendar; 29 February becomes 1 March in
// a year without it.
func addYears(d calendar.Date, years int) calendar.Date {
	return calendar.NewDate(d.Year()+years, d.Month(), d.Day())
}
