package application

import (
	"fmt"
	"slices"
	"strconv"
	"strings"

	"github.com/moto-ogs/project-phoenix/modules/carecontract"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

// The bookings an imported contract stands for, and the proof that they are
// the contract's (#7760, ADR 0309).
//
// Bookings are half-open. The booking of the version in force today starts
// on the first day the contract promises care in the phase: the service
// start of the phase, or the first day of the contract when that is later.
// No child is booked before its contract. It ends with the earliest of the
// module's last day, the end of the version, the end of a termination, the
// start of the next version and the end of the phase. Each later version is
// a change at its first day. Versions before the one in force are not
// booked: nothing reads them.
//
// The proof has two parts. The first is the amendment itself: the bookings
// are an application the contract's timeline is checked against day by day,
// as AmendFromBookings does after the binding, and no day may make a
// version. The amendment looks only at the offerings a day changes, so the
// second part compares the booked care with the promised care directly, per
// weekday, module and end time, on every day something changes
// (comparedCare). A row is ready only when both find nothing.

// enrollmentDerivation is what one contract stands for at its school.
type enrollmentDerivation struct {
	phaseID   int64
	phaseName string
	// phaseStart and phaseEnd are the first and the last day of the service
	// of the phase.
	phaseStart calendar.Date
	phaseEnd   calendar.Date
	// careStart is the first day the derived bookings hold: the later of the
	// service start of the phase and the first day of the contract.
	careStart calendar.Date
	bookings  []carecontract.EnrollmentBooking
	changes   []carecontract.EnrollmentChange
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
	derived.careStart = derived.phaseStart
	if first := contract.Versions[0].EffectiveFrom; first.After(derived.careStart) {
		derived.careStart = first
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
// force today (n = 0) is booked from the first day the contract promises
// care in the phase (careStart) with the modules that still run, a later
// one from its first day. Each ends with the version, a termination, the
// next version or the phase.
func derivedBookings(read schoolRead, contract carecontract.EnrollmentContract, versions []carecontract.Version, n int,
	derived enrollmentDerivation, today calendar.Date) ([]carecontract.EnrollmentBooking, string) {
	version := versions[n]
	window := bookingWindow{from: version.EffectiveFrom, until: derived.phaseEnd.AddDays(1)}
	services := version.Services
	if n == 0 {
		window.from, services = derived.careStart, promised(version, today)
	}
	window.cut(dayAfter(version.EndsOn))
	window.cut(dayAfter(contract.EndsOn))
	if n+1 < len(versions) {
		window.cut(&versions[n+1].EffectiveFrom)
	}
	return versionBookings(read, services, window)
}

// enrollmentPhase is the one enrollment phase the modules of the versions
// belong to, with its service running today. Of the version in force
// (versions[0]) only the modules it still promises today count: a module
// whose last day has passed is not booked, so its phase decides nothing. A
// planned version whose modules belong to another phase is a planned change
// like any other: the contract has one phase today.
func enrollmentPhase(read schoolRead, versions []carecontract.Version, today calendar.Date) (enrollmentDerivation, string) {
	derived := enrollmentDerivation{bookings: []carecontract.EnrollmentBooking{}, changes: []carecontract.EnrollmentChange{}}
	var phase *carecontract.Offering
	for n, version := range versions {
		services, other := version.Services, carecontract.EnrollmentReasonPlannedChange
		if n == 0 {
			services, other = promised(version, today), carecontract.EnrollmentReasonTwoPhases
		}
		var reason string
		if phase, reason = servicesPhase(read, services, phase, other); reason != "" {
			return derived, reason
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

// servicesPhase is the phase of the modules of the services, which is phase
// when that is known already. A module the school no longer has as a care
// offering of a phase is offering_gone; a module of another phase than
// phase is answered with other.
func servicesPhase(read schoolRead, services []carecontract.Service, phase *carecontract.Offering, other string) (*carecontract.Offering, string) {
	for _, service := range services {
		offering, known := read.offerings[service.CareOfferingID.Int64()]
		if !known || offering.PhaseID <= 0 || offering.ServiceStart == nil || offering.ServiceEnd == nil {
			return phase, carecontract.EnrollmentReasonOfferingGone
		}
		if phase != nil && phase.PhaseID != offering.PhaseID {
			return phase, other
		}
		phase = &offering
	}
	return phase, ""
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
			Days: days, ValidFrom: booked.from, ValidUntil: booked.until, EndTimes: endTimesOn(offering, days),
			AvailableDays: orderedWeekdays(offering.AvailableDays), DaysOfWeekMode: offering.DaysOfWeekMode})
	}
	return bookings, ""
}

// endTimesOn are the end times of the module on the weekdays, as the plan
// read them; a weekday without one has none.
func endTimesOn(offering carecontract.Offering, days []string) map[string]string {
	ends := make(map[string]string, len(days))
	for _, day := range days {
		ends[day] = offering.EndTimes[day]
	}
	return ends
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
// would find promised care without a booking, or the booked care differs
// from the promised care on a day from compareFrom on. Empty when the
// bookings are the contract's.
//
// An imported contract without an end promises care beyond its phase, whose
// bookings end with the school year. The amendment writes no version for
// that day either (SkipCareEnds): the contract ends by its termination, and
// the child's next phase brings its own contract (ADR 0153). So care that
// ends only after the phase holds no row back.
func provenBookings(read schoolRead, contract carecontract.EnrollmentContract, bookings []carecontract.Booking,
	compareFrom, phaseEnd, today calendar.Date) string {
	amendable := AmendableContract{ID: contract.ID, Key: ContractKey{SchoolID: contract.SchoolID}, FirstFrom: contract.FirstFrom,
		NextNumber: contract.NextNumber, Latest: contract.Versions[len(contract.Versions)-1], Versions: contract.Versions}
	plan, reason, day := firstAmendment(read, carecontract.Application{Bookings: bookings}, amendable, today)
	switch {
	case plan == nil && (reason == "" || (reason == carecontract.SkipCareEnds && day.After(phaseEnd))):
		return comparedCare(read, contract, bookings, compareFrom, phaseEnd, today)
	case plan == nil:
		return carecontract.EnrollmentReasonCareEnds
	}
	base := []carecontract.Service{}
	if current, inForce := versionAt(contract.Versions, day); inForce {
		base = promised(current, day)
	}
	return careDifference(plan.version.Services, base)
}

// careDifference names how two lists of care differ: only by an end time,
// or by a weekday or a module.
func careDifference(a, b []carecontract.Service) string {
	if sameCare(withoutEndTimes(a), withoutEndTimes(b)) {
		return carecontract.EnrollmentReasonEndTime
	}
	return carecontract.EnrollmentReasonBookingsDiffer
}

// comparedCare compares the booked care with the promised care directly, on
// every day from compareFrom to the end of the phase on which a booking, a
// version, a module or the contract starts or ends, and tells how the first
// such day differs. The amendment alone does not see every difference: it
// takes from the bookings only the offerings a day changes, so a version
// that started after its booking (a booking from the service start of the
// phase, a version from October) keeps an end time that is not the module's
// without a day that would show it.
//
// From today on the care of a day is the version's in force on that day. A
// day before today is compared with the version in force today, as far as
// that version promised care on the day: versions before it are not booked,
// and nothing reads them. On such a day no booking may run that the version
// does not promise; a module that is booked later than the phase starts
// leaves the days before it empty. Before its first day the contract
// promises nothing: no booking may run there.
func comparedCare(read schoolRead, contract carecontract.EnrollmentContract, bookings []carecontract.Booking,
	compareFrom, phaseEnd, today calendar.Date) string {
	current, _ := versionAt(contract.Versions, today)
	application := carecontract.Application{Bookings: bookings}
	for _, day := range careBoundaries(read, contract, bookings, compareFrom, phaseEnd, today) {
		version := current
		if day.After(today) {
			version, _ = versionAt(contract.Versions, day)
		}
		care := []carecontract.Service{}
		if (contract.EndsOn == nil || !day.After(*contract.EndsOn)) && !day.Before(contract.Versions[0].EffectiveFrom) {
			care = promised(version, day)
		}
		booked := servicesAt(read, application, day).services
		if day.Before(today) {
			// Only what is booked is checked against the past.
			care = promisedOf(care, booked)
		}
		if !sameCare(care, booked) {
			return careDifference(care, booked)
		}
	}
	return ""
}

// promisedOf keeps of the promised care what is booked per weekday and
// module, whatever its end time.
func promisedOf(care, booked []carecontract.Service) []carecontract.Service {
	kept := []carecontract.Service{}
	for _, service := range care {
		if slices.ContainsFunc(booked, func(b carecontract.Service) bool {
			return b.CareOfferingID == service.CareOfferingID && b.Weekday == service.Weekday
		}) {
			kept = append(kept, service)
		}
	}
	return kept
}

// careBoundaries are the days from compareFrom to the end of the phase on
// which the booked or the promised care may change, in order: compareFrom
// and today, the start and the end of each booking, the start of each
// version, and the day after a version, a module or the contract ends.
func careBoundaries(read schoolRead, contract carecontract.EnrollmentContract, bookings []carecontract.Booking,
	compareFrom, phaseEnd, today calendar.Date) []calendar.Date {
	days := []*calendar.Date{&compareFrom, &today, dayAfter(contract.EndsOn)}
	for _, booking := range bookings {
		if clipped, ok := clippedBooking(read, booking); ok {
			days = append(days, clipped.ValidFrom, clipped.ValidUntil)
		}
	}
	for _, version := range contract.Versions {
		start := version.EffectiveFrom
		days = append(days, &start, dayAfter(version.EndsOn))
		for _, service := range version.Services {
			days = append(days, dayAfter(service.LastDay))
		}
	}
	boundaries := []calendar.Date{}
	for _, day := range days {
		if day == nil || day.Before(compareFrom) || day.After(phaseEnd) || slices.Contains(boundaries, *day) {
			continue
		}
		boundaries = append(boundaries, *day)
	}
	slices.SortFunc(boundaries, func(a, b calendar.Date) int { return a.Compare(b) })
	return boundaries
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
// status, as sameTimeline compares them.
func timelineToken(versions []carecontract.Version) string {
	parts := make([]string, len(versions))
	for i, version := range versions {
		parts[i] = fmt.Sprint(version.ID, ":", version.Status)
	}
	slices.Sort(parts)
	return strings.Join(parts, ",")
}

// planToken names what a ready row was proved on: the timeline of the
// contract and the application child the binding is for, or that the row
// has none (requestChildID 0) and the school enrolls the child. A binding
// takes a contract only with the token of its row, and only for the
// application child the token names.
func planToken(versions []carecontract.Version, requestChildID int64) string {
	if requestChildID <= 0 {
		return timelineToken(versions) + "|new"
	}
	return timelineToken(versions) + "|" + strconv.FormatInt(requestChildID, 10)
}

// boundChildren are the application children of the school that have a
// contract, each with the imported contract of the school bound to it, or 0
// for a contract that came from the application.
type boundChildren map[int64]int64

// planEnrollmentRow answers one contract. applications are the accepted
// applications of its child record; contracted names the application
// children that have a contract.
func planEnrollmentRow(read schoolRead, contract carecontract.EnrollmentContract, applications []carecontract.Application,
	contracted boundChildren, today calendar.Date) carecontract.EnrollmentPlanRow {
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
	row.PhaseID, row.PhaseName, row.PhaseStart, row.PhaseEnd = ident.ID(derived.phaseID), derived.phaseName, derived.phaseStart, derived.phaseEnd
	if reason == carecontract.EnrollmentReasonCareEnds && endedEnrollment(read, contract, applications, contracted, today, &row) {
		return row
	}
	if reason != "" {
		row.Reason = reason
		return row
	}
	row.Bookings, row.Changes = derived.bookings, derived.changes
	if inPhase := phaseApplications(read, applications, derived.phaseID); len(inPhase) > 0 {
		row.Reason = boundApplication(read, contract, inPhase, contracted, derived, today, &row)
	} else {
		row.Reason = enrolledBookings(read, contract, derived, today)
	}
	if row.Reason == "" {
		row.Status, row.Token = carecontract.EnrollmentReady, planToken(contract.Versions, row.RequestChildID.Int64())
	}
	return row
}

// enrolledBookings tells why a child without an application in the phase is
// not enrolled with the derived bookings: they are not proved, a module is
// not active at the school (the school's enrollment refuses such a booking,
// with the same reason), or the contract has a planned version, which the
// silent enrollment does not write. The derived bookings start on the first
// day the contract promises care in the phase, so they are compared from
// there.
func enrolledBookings(read schoolRead, contract carecontract.EnrollmentContract, derived enrollmentDerivation, today calendar.Date) string {
	if reason := provenBookings(read, contract, derived.all(), derived.careStart, derived.phaseEnd, today); reason != "" {
		return reason
	}
	if slices.ContainsFunc(derived.all(), func(booking carecontract.Booking) bool { return !read.offerings[booking.CareOfferingID].Active }) {
		return carecontract.EnrollmentReasonOfferingInactive
	}
	if len(derived.changes) > 0 {
		return carecontract.EnrollmentReasonPlannedChange
	}
	return ""
}

// boundApplication tells why the contract is not bound to the accepted
// application the child has in the phase, and names that application in
// the row: the child never gets a second enrollment. It is bound only to a
// single application without a contract whose own bookings are proved; that
// is also what a run finds after it enrolled the child and stopped before
// the binding. The bookings of an application are what the school approved,
// with their history: they are compared from today on, since nothing before
// today makes a version or can still be changed. A proved row carries these
// bookings and the day (ApplicationBookings, ProvedOn): the school's
// enrollment compares them with what is stored under its gates.
//
// An application that has the earlier imported contract of the child is
// named as such (follows_contract): this contract follows that one in the
// phase, and the office handles it as a change of the contract.
func boundApplication(read schoolRead, contract carecontract.EnrollmentContract, inPhase []carecontract.Application,
	contracted boundChildren, derived enrollmentDerivation, today calendar.Date, row *carecontract.EnrollmentPlanRow) string {
	if reason := soleApplication(inPhase, contracted, row); reason != "" {
		return reason
	}
	if provenBookings(read, contract, inPhase[0].Bookings, today, derived.phaseEnd, today) != "" {
		return carecontract.EnrollmentReasonHasApplication
	}
	row.ApplicationBookings, row.ProvedOn = applicationBookings(read, inPhase[0].Bookings, derived, today), today
	return ""
}

// soleApplication names the one application of the phase in the row and
// tells why the contract cannot be bound to it whatever it books: there are
// several, or it has a contract already (follows_contract for an earlier
// imported one of the child).
func soleApplication(inPhase []carecontract.Application, contracted boundChildren, row *carecontract.EnrollmentPlanRow) string {
	if len(inPhase) > 1 {
		return carecontract.EnrollmentReasonHasApplication
	}
	row.RequestChildID = ident.ID(inPhase[0].RequestChildID)
	if earlier, has := contracted[inPhase[0].RequestChildID]; has {
		if earlier > 0 {
			row.FollowsContractID = ident.ID(earlier)
			return carecontract.EnrollmentReasonFollowsContract
		}
		return carecontract.EnrollmentReasonHasApplication
	}
	return ""
}

// endedEnrollment answers a contract that promises no care any more in its
// phase (care_ends) but whose child has an accepted application there, and
// tells whether it did. That is what a run leaves behind that enrolled the
// child and stopped before the binding, once the last module has ended: the
// school committed a booking through 30 June, and on 1 July nothing is
// derived any more. Without this the approved enrollment would stay unbound
// for good.
//
// The row is ready, with that application, when the binding is as sound as
// for a contract that still runs. The application is the only one of the
// child record in the phase and has no contract (soleApplication). The
// amendment that follows the bookings after the binding writes no version,
// and from the first day the contract promised care in the phase no booking
// runs that the contract did not promise (provenBookings, compared over the
// contract's time, not from today, where nothing is left to compare). And
// on the last day the contract promised care the bookings are exactly that
// care (bookedAsLastPromised): the past is otherwise compared only as far
// as it is booked, which an application with less care would pass. The row
// carries the bookings from that first day on (ProvedOn), so the school's
// enrollment confirms the whole of what is stored, not an empty rest.
//
// An application that does not pass holds the row back as has_application,
// as for a running contract. Without an application of the phase, and
// without one phase whose service runs today among the modules of the
// version in force, the row stays care_ends.
func endedEnrollment(read schoolRead, contract carecontract.EnrollmentContract, applications []carecontract.Application,
	contracted boundChildren, today calendar.Date, row *carecontract.EnrollmentPlanRow) bool {
	current, _ := versionAt(contract.Versions, today)
	phase, found := runningPhase(read, current, today)
	if !found {
		return false
	}
	inPhase := phaseApplications(read, applications, phase.PhaseID)
	if len(inPhase) == 0 {
		return false
	}
	derived := enrollmentDerivation{phaseID: phase.PhaseID, phaseName: phase.PhaseName, phaseStart: *phase.ServiceStart, phaseEnd: *phase.ServiceEnd}
	derived.careStart = derived.phaseStart
	if first := contract.Versions[0].EffectiveFrom; first.After(derived.careStart) {
		derived.careStart = first
	}
	row.PhaseID, row.PhaseName, row.PhaseStart, row.PhaseEnd = ident.ID(derived.phaseID), derived.phaseName, derived.phaseStart, derived.phaseEnd
	if row.Reason = soleApplication(inPhase, contracted, row); row.Reason != "" {
		return true
	}
	bookings := inPhase[0].Bookings
	if provenBookings(read, contract, bookings, derived.careStart, derived.phaseEnd, today) != "" ||
		!bookedAsLastPromised(read, contract, bookings, derived, today) {
		row.Reason = carecontract.EnrollmentReasonHasApplication
		return true
	}
	row.ApplicationBookings, row.ProvedOn = applicationBookings(read, bookings, derived, derived.careStart), derived.careStart
	row.Status, row.Token = carecontract.EnrollmentReady, planToken(contract.Versions, row.RequestChildID.Int64())
	return true
}

// runningPhase is the one enrollment phase whose service runs today among
// the modules of the version, whether they still run or not; false with
// none or several. A module of an earlier school year decides nothing.
func runningPhase(read schoolRead, version carecontract.Version, today calendar.Date) (carecontract.Offering, bool) {
	var phase carecontract.Offering
	found := false
	for _, service := range version.Services {
		offering, known := read.offerings[service.CareOfferingID.Int64()]
		if !known || offering.PhaseID <= 0 || offering.ServiceStart == nil || offering.ServiceEnd == nil ||
			offering.ServiceStart.After(today) || offering.ServiceEnd.Before(today) {
			continue
		}
		if found && phase.PhaseID != offering.PhaseID {
			return carecontract.Offering{}, false
		}
		phase, found = offering, true
	}
	return phase, found
}

// bookedAsLastPromised tells whether, on the last day before today the
// contract promised care in the phase, the bookings are exactly that care:
// weekday, module and end time. The days in between are the days the booked
// or the promised care may change (careBoundaries), so the care of the last
// of them with a promise is the care the contract ended with.
func bookedAsLastPromised(read schoolRead, contract carecontract.EnrollmentContract, bookings []carecontract.Booking,
	derived enrollmentDerivation, today calendar.Date) bool {
	current, _ := versionAt(contract.Versions, today)
	application := carecontract.Application{Bookings: bookings}
	same := false
	for _, day := range careBoundaries(read, contract, bookings, derived.careStart, derived.phaseEnd, today) {
		if !day.Before(today) || (contract.EndsOn != nil && day.After(*contract.EndsOn)) {
			break
		}
		if care := promised(current, day); len(care) > 0 {
			same = sameCare(care, servicesAt(read, application, day).services)
		}
	}
	return same
}

// applicationBookings are the bookings of an application as they hold in
// the phase from today on, with what the plan read of each module: what the
// proof of the application stands on. For a contract that promises no care
// any more, today is the first day it promised care in the phase.
func applicationBookings(read schoolRead, stored []carecontract.Booking, derived enrollmentDerivation, today calendar.Date) []carecontract.EnrollmentBooking {
	bookings := []carecontract.EnrollmentBooking{}
	for _, booking := range stored {
		offering, care := read.offerings[booking.CareOfferingID]
		if !care || offering.PhaseID != derived.phaseID {
			continue
		}
		clipped, holds := bookingWithinPhase(booking, offering, today)
		if !holds || clipped.ValidFrom == nil || clipped.ValidUntil == nil {
			continue
		}
		from := *clipped.ValidFrom
		if from.Before(today) {
			from = today
		}
		days := orderedWeekdays(booking.Days)
		timed := days
		if len(timed) == 0 {
			// A module with fixed weekdays stores none: it is booked on all.
			timed = orderedWeekdays(offering.AvailableDays)
		}
		bookings = append(bookings, carecontract.EnrollmentBooking{CareOfferingID: ident.ID(offering.ID), ModuleName: offering.Name,
			Days: days, ValidFrom: from, ValidUntil: *clipped.ValidUntil, EndTimes: endTimesOn(offering, timed),
			AvailableDays: orderedWeekdays(offering.AvailableDays), DaysOfWeekMode: offering.DaysOfWeekMode})
	}
	return bookings
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
