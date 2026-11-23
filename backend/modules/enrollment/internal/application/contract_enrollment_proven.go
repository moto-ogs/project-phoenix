package application

import (
	"slices"

	enrollmentNative "github.com/moto-ogs/project-phoenix/modules/enrollment"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// The confirmation of an accepted application the plan of the Träger proved
// (#7760, ADR 0309). The plan read the application's bookings in an earlier
// statement; a contract is bound to it only after the school's enrollment
// found it unchanged under its gates. So a row that names an application
// child is answered here, and never by the plan alone.

// confirmProvenApplication answers a row that names the accepted
// application of its child: existing when that approved child is the only
// request child of the phase that holds the child record and its stored
// bookings from the day of the plan on are the ones the plan proved, with
// the phase and the offerings as the plan read them. Another application of
// the child in the phase is named (has_application). Anything else is
// changed: the application is gone or no longer approved, the office
// matched it to the child record, or its bookings, its phase or an offering
// changed since the plan. The caller plans again. Nothing is written.
func confirmProvenApplication(phase *contractPhase, input enrollmentNative.ContractEnrollment, result *enrollmentNative.ContractEnrollmentResult) {
	result.Status = enrollmentNative.ContractEnrollmentChanged
	var named *enrollmentNative.ContractEnrollmentHolder
	for _, holder := range phase.holders[input.StudentID] {
		if holder.RequestChildID != input.RequestChildID {
			result.Status = enrollmentNative.ContractEnrollmentHasApplication
			result.RequestID, result.RequestChildID = holder.RequestID, holder.RequestChildID
			return
		}
		named = &holder
	}
	if named == nil || named.Status != enrollmentNative.ChildStatusApproved || named.MatchedByOffice {
		return
	}
	result.RequestID, result.RequestChildID = named.RequestID, named.RequestChildID
	if provenAsStored(phase, input) {
		result.Status = enrollmentNative.ContractEnrollmentExisting
	}
}

// provenAsStored compares the bookings the plan proved with the stored
// bookings of the application, the way the plan read them: per offering
// that counts as care, the weekdays and the time the booking holds within
// the service of the phase, from the day of the plan on. A booking that
// ended before that day is history and compares nothing.
func provenAsStored(phase *contractPhase, input enrollmentNative.ContractEnrollment) bool {
	if !phaseAsPlanned(phase, input) || input.ProvedOn.IsZero() {
		return false
	}
	proven := make([]string, 0, len(input.Bookings))
	for _, booking := range input.Bookings {
		offering := phase.offerings[booking.CareOfferingID]
		if offering == nil || !offeringAsPlanned(offering, booking) {
			return false
		}
		days := make([]string, 0, len(booking.Days))
		for _, day := range booking.Days {
			days = append(days, normalizedWeekday(day))
		}
		from, until := booking.ValidFrom, booking.ValidUntil
		proven = append(proven, contractBookingKey(offering.ID, days, &from, &until))
	}
	slices.Sort(proven)
	return slices.Equal(proven, storedFrom(phase, phase.stored[input.RequestChildID], input.ProvedOn))
}

// storedFrom are the keys of the stored bookings of care offerings of the
// phase as they hold from day on, clipped to the service of the phase.
func storedFrom(phase *contractPhase, stored []*enrollmentNative.RequestChildOffering, day calendar.Date) []string {
	start, end := phase.window()
	if day.After(start) {
		start = day
	}
	keys := []string{}
	for _, row := range stored {
		if row == nil {
			continue
		}
		offering := phase.offerings[row.CareOfferingID]
		if offering == nil || !offering.CountsAsCare {
			continue
		}
		from, until := start, end
		if row.ValidFrom != nil && calendar.Date(*row.ValidFrom).After(from) {
			from = calendar.Date(*row.ValidFrom)
		}
		if row.ValidUntil != nil && calendar.Date(*row.ValidUntil).Before(until) {
			until = calendar.Date(*row.ValidUntil)
		}
		if from.Before(until) {
			keys = append(keys, contractBookingKey(offering.ID, row.SelectedDays, &from, &until))
		}
	}
	slices.Sort(keys)
	return keys
}
