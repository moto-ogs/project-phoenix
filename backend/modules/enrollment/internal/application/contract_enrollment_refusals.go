package application

import (
	"slices"
	"time"

	enrollmentNative "github.com/moto-ogs/project-phoenix/modules/enrollment"
	offeringContract "github.com/moto-ogs/project-phoenix/modules/enrollment/offeringcontract"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// Why the enrollment of the children of imported care contracts (#7760, ADR
// 0309) refuses a child or a booking before it writes anything, and how a
// repeated call compares what it asks for with what is stored. Every check
// here reads what the run read under its gates; none reads itself.

// contractChildRefusal tells why a child gets no enrollment, given the
// refusal of its bookings (reason, empty without one). The child record
// decides first: it is gone, not active, or has no OGS place, which an
// enrollment would grant. Then the bookings; then the day they start, which
// is never after today, because the plan books only a contract and a phase
// that began; the care end of the child record, which no booking may
// outlast; a planned change; and the date of birth a request child needs.
func contractChildRefusal(student enrollmentNative.ContractStudent, known bool, input enrollmentNative.ContractEnrollment,
	reason string, today calendar.Date) string {
	switch {
	case !known:
		return enrollmentNative.ContractEnrollmentStudentMissing
	case student.Status != studentStatusActive:
		return enrollmentNative.ContractEnrollmentStudentInactive
	case student.WithoutCarePlace:
		return enrollmentNative.ContractEnrollmentWithoutCarePlace
	case reason != "":
		return reason
	case input.Bookings[0].ValidFrom.After(today):
		return enrollmentNative.ContractEnrollmentBookingWindow
	case careEndsEarlier(student, input.Bookings):
		return enrollmentNative.ContractEnrollmentCareEndsEarlier
	case len(input.Changes) > 0:
		return enrollmentNative.ContractEnrollmentPlannedChange
	case student.Birthday == nil || student.Birthday.IsZero():
		return enrollmentNative.ContractEnrollmentBirthDateMissing
	}
	return ""
}

// refuseGoneRecord refuses an application the run would confirm (existing)
// when its child record is gone or no longer active. A confirmation leads
// to the binding of the contract, and a contract is not bound to the
// enrollment of a child that left the school: the office ends the contract
// or reactivates the child record first. Nothing else about the child
// record refuses a confirmation; the school approved that application
// itself.
func (r *contractRun) refuseGoneRecord(input enrollmentNative.ContractEnrollment, result *enrollmentNative.ContractEnrollmentResult) {
	if result.Status != enrollmentNative.ContractEnrollmentExisting {
		return
	}
	student, known := r.students[input.StudentID]
	switch {
	case !known:
		result.Status, result.Reason = enrollmentNative.ContractEnrollmentRefused, enrollmentNative.ContractEnrollmentStudentMissing
	case student.Status != studentStatusActive:
		result.Status, result.Reason = enrollmentNative.ContractEnrollmentRefused, enrollmentNative.ContractEnrollmentStudentInactive
	}
}

// careEndsEarlier tells whether the child record names a last care day
// before the last day of a booking. The bookings would promise care the
// child record has ended: Care Plan cuts the roster rows at the care end,
// and the bookings would stand beyond it.
func careEndsEarlier(student enrollmentNative.ContractStudent, bookings []enrollmentNative.ContractBooking) bool {
	if student.CareEnd == nil || student.CareEnd.IsZero() {
		return false
	}
	end := student.CareEnd.AddDays(1)
	return slices.ContainsFunc(bookings, func(booking enrollmentNative.ContractBooking) bool {
		return booking.ValidUntil.After(end)
	})
}

// contractBookingRefusal checks one booking against its offering and
// answers the weekdays it stores, or why it is refused: the offering is no
// longer what the plan read (contractStale), a weekday is not on offer, or
// the booking is a second one of its offering or outside the window of the
// child. A stored enrollment of this source is compared against the same
// checks (answerContractHolder).
func contractBookingRefusal(phase *contractPhase, offering *offeringContract.CareOfferingRecord, booking enrollmentNative.ContractBooking,
	bookedTwice bool, careStart calendar.Date) ([]string, string) {
	if !offeringAsPlanned(offering, booking) {
		return nil, contractStale
	}
	days, ok := contractBookingDays(offering, booking.Days)
	switch {
	case !ok:
		return nil, enrollmentNative.ContractEnrollmentDayUnavailable
	case bookedTwice || !bookingInWindow(phase, booking, careStart):
		return nil, enrollmentNative.ContractEnrollmentBookingWindow
	}
	return days, ""
}

// contractBookingGuard tells why a booking that is not refused as such gets
// no new enrollment: Care Plan would derive no roster from it, or a wrong
// one. Its offering is not active, so a roster that names it as one of its
// sources leaves it out and the child would be approved on no roster; its
// roster cannot end with it; or its window holds none of one of its
// weekdays. These guard the creation only: an enrollment that is stored
// already is not written again, so none of them refuses a repeated call.
func contractBookingGuard(phase *contractPhase, offering *offeringContract.CareOfferingRecord, booking enrollmentNative.ContractBooking) string {
	switch {
	case !offering.IsActive:
		return enrollmentNative.ContractEnrollmentOfferingInactive
	case rosterBound(phase, offering, booking):
		return enrollmentNative.ContractEnrollmentRosterBound
	case !weekdaysInWindow(booking):
		return enrollmentNative.ContractEnrollmentWindowTooShort
	}
	return ""
}

// rosterBound tells whether the booking ends before the service of the
// phase on an offering that names its roster through the direct link
// (ActivityGroupID). Care Plan writes the roster row of such an offering to
// the end of the phase whatever the booking says, so the child would stay
// on the roster and its occurrences after the booking ended. Ending the row
// with the booking is not done here: where the same roster also names
// another offering of the child as its only source, the row of the direct
// link replaces the row of that source, and the child would drop off the
// roster while the other offering still books it (ADR 0309, known
// limitation). Two such bookings that end on different days on one roster
// are refused by the same rule: one of them ends before the service.
func rosterBound(phase *contractPhase, offering *offeringContract.CareOfferingRecord, booking enrollmentNative.ContractBooking) bool {
	_, until := phase.window()
	return offering.ActivityGroupID != nil && *offering.ActivityGroupID > 0 && booking.ValidUntil.Before(until)
}

var contractWeekdays = map[time.Weekday]string{time.Monday: "mon", time.Tuesday: "tue", time.Wednesday: "wed", time.Thursday: "thu",
	time.Friday: "fri", time.Saturday: "sat", time.Sunday: "sun"}

// weekdaysInWindow tells whether every weekday of the booking has a day in
// its window. Care Plan's roster check asks that of the window the rosters
// are derived over and answers a missing weekday with an error, which would
// abort the enrollment of every child of the call: a Monday and Friday
// booking from Thursday 30 July to the end of the service on Friday 31 July
// is such a case. The window of the booking lies within that window, so a
// booking that passes here passes there.
func weekdaysInWindow(booking enrollmentNative.ContractBooking) bool {
	if booking.ValidFrom.DaysUntil(booking.ValidUntil) >= len(contractWeekdays) {
		return true
	}
	held := map[string]bool{}
	for day := booking.ValidFrom; day.Before(booking.ValidUntil); day = day.AddDays(1) {
		held[contractWeekdays[day.Weekday()]] = true
	}
	return !slices.ContainsFunc(booking.Days, func(day string) bool { return !held[normalizedWeekday(day)] })
}

// enrolledAsStored compares the bookings a repeated call asks for with the
// stored bookings of the enrollment of this source: per offering the
// weekdays the booking holds in effect and its time. The effective weekdays
// are compared, not the ones the enrollment wrote: a correction of the
// office since then may have added a weekday another offering books along
// (an automatic day), and such an enrollment is no longer the one asked for.
// An offering with fixed weekdays holds all of them.
func enrolledAsStored(phase *contractPhase, stored []*enrollmentNative.RequestChildOffering, bookings []enrollmentNative.ContractBooking) bool {
	have := make([]string, 0, len(stored))
	for _, row := range stored {
		if row == nil {
			continue
		}
		days := row.SelectedDays
		if len(days) == 0 {
			days = slices.Concat(row.ManualSelectedDays, row.AutomaticSelectedDays)
		}
		have = append(have, contractBookingKey(row.CareOfferingID, effectiveContractDays(phase.offerings[row.CareOfferingID], days),
			(*calendar.Date)(row.ValidFrom), (*calendar.Date)(row.ValidUntil)))
	}
	want := make([]string, 0, len(bookings))
	for _, booking := range bookings {
		from, until := booking.ValidFrom, booking.ValidUntil
		want = append(want, contractBookingKey(booking.CareOfferingID, effectiveContractDays(phase.offerings[booking.CareOfferingID], booking.Days), &from, &until))
	}
	slices.Sort(have)
	slices.Sort(want)
	return slices.Equal(have, want)
}

// effectiveContractDays are the weekdays a booking of the offering holds:
// all the offering offers when they are fixed, else the ones given, as a
// sorted set.
func effectiveContractDays(offering *offeringContract.CareOfferingRecord, days []string) []string {
	if offering != nil && offering.DaysOfWeekMode == offeringContract.DaysOfWeekModeFixed {
		days = offering.AvailableDays
	}
	normalized := make([]string, 0, len(days))
	for _, day := range days {
		normalized = append(normalized, normalizedWeekday(day))
	}
	slices.Sort(normalized)
	return slices.Compact(normalized)
}
