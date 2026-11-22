package application

import (
	"fmt"
	"slices"
	"strings"

	"github.com/moto-ogs/project-phoenix/modules/carecontract"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

// The bookings an imported contract stands for, and the proof that they are
// the contract's (#7760, ADR 0308).
//
// Bookings are half-open and the roster of an approved child is read at the
// service start of its phase, so the booking of the version in force today
// starts there, whenever the contract started. It ends with the earliest of
// the module's last day, the end of the version, the end of a termination,
// the start of the next version and the end of the phase. Each later version
// is a change at its first day. Versions before the one in force are not
// booked: nothing reads them.
//
// The proof is the amendment itself: the derived bookings are an
// application the contract's timeline is checked against day by day, as
// AmendFromBookings does after the binding. A row is ready only when no day
// would make a version.

// enrollmentDerivation is what one contract stands for at its school.
type enrollmentDerivation struct {
	phaseID   int64
	phaseName string
	// phaseStart and phaseEnd are the first and the last day of the service
	// of the phase.
	phaseStart calendar.Date
	phaseEnd   calendar.Date
	bookings   []carecontract.EnrollmentBooking
	changes    []carecontract.EnrollmentChange
}

// all are the bookings of the derivation as one application books them.
func (d enrollmentDerivation) all() []carecontract.Booking {
	bookings := enrollmentBookings(d.bookings)
	for _, change := range d.changes {
		bookings = append(bookings, enrollmentBookings(change.Bookings)...)
	}
	return bookings
}

func enrollmentBookings(planned []carecontract.EnrollmentBooking) []carecontract.Booking {
	bookings := make([]carecontract.Booking, len(planned))
	for i, booking := range planned {
		from, until := booking.ValidFrom, booking.ValidUntil
		bookings[i] = carecontract.Booking{CareOfferingID: booking.CareOfferingID.Int64(), Days: booking.Days, ValidFrom: &from, ValidUntil: &until}
	}
	return bookings
}

// deriveEnrollment turns the versions of a contract from today on into
// bookings; the reason says why it cannot.
func deriveEnrollment(read schoolRead, contract carecontract.EnrollmentContract, today calendar.Date) (enrollmentDerivation, string) {
	if contract.Status != carecontract.StatusActive || len(contract.Versions) == 0 {
		return enrollmentDerivation{}, carecontract.EnrollmentReasonContractNotActive
	}
	current, inForce := versionAt(contract.Versions, today)
	if !inForce {
		return enrollmentDerivation{}, carecontract.EnrollmentReasonNotBegun
	}
	versions := []carecontract.Version{current}
	for _, version := range contract.Versions {
		if version.EffectiveFrom.After(today) {
			versions = append(versions, version)
		}
	}
	derived, reason := enrollmentPhase(read, versions, today)
	if reason != "" {
		return derived, reason
	}
	for i := range versions {
		bookings, reason := derivedBookings(read, contract, versions, i, derived, today)
		if reason != "" {
			return derived, reason
		}
		if i == 0 {
			derived.bookings = bookings
			continue
		}
		derived.changes = append(derived.changes, carecontract.EnrollmentChange{EffectiveFrom: versions[i].EffectiveFrom, Bookings: bookings})
	}
	if len(derived.bookings) == 0 {
		return derived, carecontract.EnrollmentReasonCareEnds
	}
	return derived, ""
}

// derivedBookings are the bookings of version n of versions: the version in
// force today (n = 0) is booked from the service start of the phase with
// the modules that still run, a later one from its first day. Each ends
// with the version, a termination, the next version or the phase.
func derivedBookings(read schoolRead, contract carecontract.EnrollmentContract, versions []carecontract.Version, n int,
	derived enrollmentDerivation, today calendar.Date) ([]carecontract.EnrollmentBooking, string) {
	version := versions[n]
	window := bookingWindow{from: version.EffectiveFrom, until: derived.phaseEnd.AddDays(1)}
	services := version.Services
	if n == 0 {
		window.from, services = derived.phaseStart, promised(version, today)
	}
	window.cut(dayAfter(version.EndsOn))
	window.cut(dayAfter(contract.EndsOn))
	if n+1 < len(versions) {
		window.cut(&versions[n+1].EffectiveFrom)
	}
	return versionBookings(read, services, window)
}

// enrollmentPhase is the one enrollment phase the modules of the versions
// belong to, with its service running today.
func enrollmentPhase(read schoolRead, versions []carecontract.Version, today calendar.Date) (enrollmentDerivation, string) {
	derived := enrollmentDerivation{bookings: []carecontract.EnrollmentBooking{}, changes: []carecontract.EnrollmentChange{}}
	var phase *carecontract.Offering
	for _, version := range versions {
		for _, service := range version.Services {
			offering, known := read.offerings[service.CareOfferingID.Int64()]
			if !known || offering.PhaseID <= 0 || offering.ServiceStart == nil || offering.ServiceEnd == nil {
				return derived, carecontract.EnrollmentReasonOfferingGone
			}
			if phase != nil && phase.PhaseID != offering.PhaseID {
				return derived, carecontract.EnrollmentReasonTwoPhases
			}
			phase = &offering
		}
	}
	if phase == nil {
		return derived, carecontract.EnrollmentReasonCareEnds
	}
	derived.phaseID, derived.phaseName = phase.PhaseID, phase.PhaseName
	derived.phaseStart, derived.phaseEnd = *phase.ServiceStart, *phase.ServiceEnd
	switch {
	case phase.ServiceStart.After(today):
		return derived, carecontract.EnrollmentReasonPhaseNotBegun
	case phase.ServiceEnd.Before(today):
		return derived, carecontract.EnrollmentReasonPhaseEnded
	}
	return derived, ""
}

// bookingWindow is the half-open time a booking holds.
type bookingWindow struct {
	from  calendar.Date
	until calendar.Date
}

// cut ends the window on day when that is earlier.
func (w *bookingWindow) cut(day *calendar.Date) {
	if day != nil && day.Before(w.until) {
		w.until = *day
	}
}

// versionBookings are the bookings of the services of one version: per
// module its weekdays, over the window and at most to the day after the
// module's last day. A module whose time is over is left out.
func versionBookings(read schoolRead, services []carecontract.Service, window bookingWindow) ([]carecontract.EnrollmentBooking, string) {
	bookings := []carecontract.EnrollmentBooking{}
	for _, offeringID := range serviceOfferings(services) {
		offering := read.offerings[offeringID]
		days, lastDay := []string{}, (*calendar.Date)(nil)
		for _, service := range services {
			if service.CareOfferingID.Int64() != offeringID {
				continue
			}
			days = append(days, service.Weekday)
			if service.LastDay != nil && (lastDay == nil || service.LastDay.Before(*lastDay)) {
				lastDay = service.LastDay
			}
		}
		days = orderedWeekdays(days)
		if reason := bookableDays(offering, days); reason != "" {
			return nil, reason
		}
		// Weekdays of one module that end on different days cannot be one
		// booking; the earliest end is booked and the proof names the rest.
		booked := window
		booked.cut(dayAfter(lastDay))
		if !booked.from.Before(booked.until) {
			continue
		}
		bookings = append(bookings, carecontract.EnrollmentBooking{CareOfferingID: ident.ID(offeringID), ModuleName: offering.Name,
			Days: days, ValidFrom: booked.from, ValidUntil: booked.until})
	}
	return bookings, ""
}

// bookableDays tells why the module cannot be booked on the weekdays: a
// module with fixed weekdays is booked on all of them, any other on weekdays
// it offers.
func bookableDays(offering carecontract.Offering, days []string) string {
	if offering.DaysOfWeekMode == "fixed" {
		if !slices.Equal(days, orderedWeekdays(offering.AvailableDays)) {
			return carecontract.EnrollmentReasonFixedDays
		}
		return ""
	}
	for _, day := range days {
		if !slices.Contains(offering.AvailableDays, day) {
			return carecontract.EnrollmentReasonDayUnavailable
		}
	}
	return ""
}

func serviceOfferings(services []carecontract.Service) []int64 {
	ids := []int64{}
	for _, service := range services {
		if id := service.CareOfferingID.Int64(); !slices.Contains(ids, id) {
			ids = append(ids, id)
		}
	}
	return ids
}

// orderedWeekdays are the weekdays once each, Monday first.
func orderedWeekdays(days []string) []string {
	ordered := []string{}
	for _, day := range weekdayOrder {
		if slices.Contains(days, day) {
			ordered = append(ordered, day)
		}
	}
	return ordered
}

// provenBookings tells why bookings are not the contract's: the amendment
// that follows the bookings after the binding would write a version, or
// would find promised care without a booking. Empty when it would write
// none.
//
// An imported contract without an end promises care beyond its phase, whose
// bookings end with the school year. The amendment writes no version for
// that day either (SkipCareEnds): the contract ends by its termination, and
// the child's next phase brings its own contract (ADR 0153). So care that
// ends only after the phase holds no row back.
func provenBookings(read schoolRead, contract carecontract.EnrollmentContract, bookings []carecontract.Booking,
	phaseEnd, today calendar.Date) string {
	amendable := AmendableContract{ID: contract.ID, Key: ContractKey{SchoolID: contract.SchoolID}, FirstFrom: contract.FirstFrom,
		NextNumber: contract.NextNumber, Latest: contract.Versions[len(contract.Versions)-1], Versions: contract.Versions}
	plan, reason, day := firstAmendment(read, carecontract.Application{Bookings: bookings}, amendable, today)
	switch {
	case plan == nil && reason == "":
		return ""
	case plan == nil && reason == carecontract.SkipCareEnds && day.After(phaseEnd):
		return ""
	case plan == nil:
		return carecontract.EnrollmentReasonCareEnds
	}
	base := []carecontract.Service{}
	if current, inForce := versionAt(contract.Versions, day); inForce {
		base = promised(current, day)
	}
	if sameCare(withoutEndTimes(plan.version.Services), withoutEndTimes(base)) {
		return carecontract.EnrollmentReasonEndTime
	}
	return carecontract.EnrollmentReasonBookingsDiffer
}

func withoutEndTimes(services []carecontract.Service) []carecontract.Service {
	plain := make([]carecontract.Service, len(services))
	for i, service := range services {
		service.EndsAt = ""
		plain[i] = service
	}
	return plain
}

// timelineToken names the effective versions of a contract with their
// status, as sameTimeline compares them: a binding takes a contract only
// with the timeline its plan was made on.
func timelineToken(versions []carecontract.Version) string {
	parts := make([]string, len(versions))
	for i, version := range versions {
		parts[i] = fmt.Sprint(version.ID, ":", version.Status)
	}
	slices.Sort(parts)
	return strings.Join(parts, ",")
}

// planEnrollmentRow answers one contract. applications are the accepted
// applications of its child record; contracted names the application
// children that have a contract.
func planEnrollmentRow(read schoolRead, contract carecontract.EnrollmentContract, applications []carecontract.Application,
	contracted map[int64]bool, today calendar.Date) carecontract.EnrollmentPlanRow {
	row := carecontract.EnrollmentPlanRow{ContractID: ident.ID(contract.ID), ChildFirstName: contract.ChildFirstName,
		ChildLastName: contract.ChildLastName, Bookings: []carecontract.EnrollmentBooking{}, Changes: []carecontract.EnrollmentChange{}}
	if contract.StudentID != nil {
		row.StudentID = ident.ID(*contract.StudentID)
	}
	switch {
	case contract.RequestChildID != nil:
		row.Status, row.RequestChildID = carecontract.EnrollmentDone, ident.ID(*contract.RequestChildID)
		return row
	case contract.StudentID == nil:
		row.Status = carecontract.EnrollmentUnlinked
		return row
	}
	row.Status = carecontract.EnrollmentHeld
	derived, reason := deriveEnrollment(read, contract, today)
	row.PhaseID, row.PhaseName = ident.ID(derived.phaseID), derived.phaseName
	if reason != "" {
		row.Reason = reason
		return row
	}
	row.Bookings, row.Changes, row.Timeline = derived.bookings, derived.changes, timelineToken(contract.Versions)
	bookings := derived.all()
	if inPhase := phaseApplications(read, applications, derived.phaseID); len(inPhase) > 0 {
		// The child has an accepted application in the phase: the contract
		// is bound to it when its bookings are the contract's, never to a
		// second enrollment.
		row.Reason = carecontract.EnrollmentReasonHasApplication
		if len(inPhase) > 1 {
			return row
		}
		row.RequestChildID = ident.ID(inPhase[0].RequestChildID)
		if contracted[inPhase[0].RequestChildID] {
			return row
		}
		bookings = inPhase[0].Bookings
	}
	if reason := provenBookings(read, contract, bookings, derived.phaseEnd, today); reason != "" {
		if row.Reason == "" {
			row.Reason = reason
		}
		return row
	}
	row.Status, row.Reason = carecontract.EnrollmentReady, ""
	return row
}

// phaseApplications are the applications that book a care offering of the
// phase.
func phaseApplications(read schoolRead, applications []carecontract.Application, phaseID int64) []carecontract.Application {
	inPhase := []carecontract.Application{}
	for _, application := range applications {
		if slices.ContainsFunc(application.Bookings, func(booking carecontract.Booking) bool {
			offering, care := read.offerings[booking.CareOfferingID]
			return care && offering.PhaseID == phaseID
		}) {
			inPhase = append(inPhase, application)
		}
	}
	return inPhase
}
