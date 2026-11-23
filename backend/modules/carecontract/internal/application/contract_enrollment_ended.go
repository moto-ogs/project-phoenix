package application

import (
	"slices"

	"github.com/moto-ogs/project-phoenix/modules/carecontract"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

// The contract that promises no care any more in its phase but whose child
// has an accepted application there (#7760, ADR 0309). That is what a run
// leaves behind that enrolled the child and stopped before the binding, once
// the last module has ended: the school committed a booking through 30 June,
// and on 1 July nothing is derived any more. Without this the approved
// enrollment would stay unbound for good.

// endedEnrollment answers such a contract (care_ends) and tells whether it
// did.
//
// The phase is chosen from the stored application, not from the modules of
// the contract alone: of the phases whose service runs today among the
// modules of the version in force, the one in which the child has the
// application that passes the proof. A school that extended the phase of an
// expired module leaves the contract with two running phases; the stored
// enrollment still names the one it was made in. Without a phase that
// passes, the first one with an application answers, as held.
//
// Without an application in any of these phases the row stays care_ends.
func endedEnrollment(read schoolRead, contract carecontract.EnrollmentContract, applications []carecontract.Application,
	contracted boundChildren, today calendar.Date, row *carecontract.EnrollmentPlanRow) bool {
	current, _ := versionAt(contract.Versions, today)
	var held *carecontract.EnrollmentPlanRow
	for _, phase := range runningPhases(read, current, today) {
		inPhase := phaseApplications(read, applications, phase.PhaseID)
		if len(inPhase) == 0 {
			continue
		}
		answer := *row
		endedInPhase(read, contract, inPhase, contracted, phase, today, &answer)
		if answer.Status == carecontract.EnrollmentReady {
			*row = answer
			return true
		}
		if held == nil {
			held = &answer
		}
	}
	if held == nil {
		return false
	}
	*row = *held
	return true
}

// endedInPhase answers the contract against the applications of its child
// in one running phase.
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
// An application that does not pass holds the row back: as planned_change
// when the contract has a version that starts after today, which is what
// the bookings do not carry, else as has_application, as for a running
// contract.
func endedInPhase(read schoolRead, contract carecontract.EnrollmentContract, inPhase []carecontract.Application,
	contracted boundChildren, phase carecontract.Offering, today calendar.Date, row *carecontract.EnrollmentPlanRow) {
	derived := enrollmentDerivation{phaseID: phase.PhaseID, phaseName: phase.PhaseName, phaseStart: *phase.ServiceStart, phaseEnd: *phase.ServiceEnd}
	derived.careStart = derived.phaseStart
	if first := contract.Versions[0].EffectiveFrom; first.After(derived.careStart) {
		derived.careStart = first
	}
	row.PhaseID, row.PhaseName, row.PhaseStart, row.PhaseEnd = ident.ID(derived.phaseID), derived.phaseName, derived.phaseStart, derived.phaseEnd
	if row.Reason = soleApplication(inPhase, contracted, row); row.Reason != "" {
		return
	}
	bookings := inPhase[0].Bookings
	if provenBookings(read, contract, bookings, derived.careStart, derived.phaseEnd, today) != "" ||
		!bookedAsLastPromised(read, contract, bookings, derived, today) {
		row.Reason = carecontract.EnrollmentReasonHasApplication
		if slices.ContainsFunc(contract.Versions, func(version carecontract.Version) bool { return version.EffectiveFrom.After(today) }) {
			row.Reason = carecontract.EnrollmentReasonPlannedChange
		}
		return
	}
	row.ApplicationBookings, row.ProvedOn = applicationBookings(read, bookings, derived, derived.careStart), derived.careStart
	row.Status, row.Token = carecontract.EnrollmentReady, planToken(contract.Versions, row.RequestChildID.Int64())
}

// runningPhases are the enrollment phases whose service runs today among
// the modules of the version, whether they still run or not, each once and
// by phase. A module of an earlier school year decides nothing.
func runningPhases(read schoolRead, version carecontract.Version, today calendar.Date) []carecontract.Offering {
	phases := []carecontract.Offering{}
	for _, service := range version.Services {
		offering, known := read.offerings[service.CareOfferingID.Int64()]
		if !known || offering.PhaseID <= 0 || offering.ServiceStart == nil || offering.ServiceEnd == nil ||
			offering.ServiceStart.After(today) || offering.ServiceEnd.Before(today) {
			continue
		}
		if !slices.ContainsFunc(phases, func(phase carecontract.Offering) bool { return phase.PhaseID == offering.PhaseID }) {
			phases = append(phases, offering)
		}
	}
	slices.SortFunc(phases, func(a, b carecontract.Offering) int { return int(a.PhaseID - b.PhaseID) })
	return phases
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
