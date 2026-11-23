package application

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/modules/carecontract"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

// What the plan says after a run that enrolled a child and stopped before
// the binding (#7760, ADR 0309 section 4): which phase the stored
// enrollment is proved in, which reason answers first, and how a row names
// an enrollment the contract can no longer be bound to.

// endedContract is enrollableContract whose modules ended on 30 June 2031,
// with the application a run stored for it.
func endedContract() (carecontract.EnrollmentContract, carecontract.Application) {
	contract := enrollableContract()
	contract.Versions[0].Services[0].LastDay, contract.Versions[0].Services[1].LastDay = date(2031, 6, 30), date(2031, 6, 30)
	student := plannedStudent
	return contract, carecontract.Application{RequestChildID: plannedRequestChild, StudentID: &student, ContractImport: true, ImportContractID: contract.ID,
		Bookings: []carecontract.Booking{{CareOfferingID: 1, Days: []string{"mon", "tue"}, ValidFrom: date(2030, 8, 1), ValidUntil: date(2031, 7, 1)}}}
}

// The contract also names a module that ended long ago, and the school has
// since extended the phase of that module: two phases run today among the
// modules of the version. The phase is chosen from the stored application,
// the one whose bookings pass the proof, so the enrollment is still bound.
func TestTheRecoveryPhaseIsTheOneOfTheStoredApplication(t *testing.T) {
	t.Parallel()
	contract, stored := endedContract()
	old := importedService("wed", 4, "Ganztag 2031/32", "16:30")
	old.LastDay = date(2030, 9, 30)
	contract.Versions[0].Services = append(contract.Versions[0].Services, old)
	school := enrollmentSchool()
	extended := school.offerings[4]
	// The school moved the service of the other phase over today.
	extended.PhaseID, extended.ServiceStart, extended.ServiceEnd = 69, date(2030, 8, 1), date(2031, 7, 31)
	school.offerings[4] = extended
	today := *date(2031, 7, 1)

	row := planEnrollmentRow(school, contract, []carecontract.Application{stored}, boundChildren{}, today)
	require.Equal(t, carecontract.EnrollmentReady, row.Status, row.Reason)
	assert.Equal(t, ident.ID(70), row.PhaseID, "the phase the enrollment was made in, not the first one that runs")
	assert.Equal(t, ident.ID(plannedRequestChild), row.RequestChildID)

	alone := planEnrollmentRow(school, contract, nil, boundChildren{}, today)
	assert.Equal(t, carecontract.EnrollmentReasonCareEnds, alone.Reason, "without an application in a running phase nothing changes")
	assert.Zero(t, alone.EnrollmentChildID)
}

// A planned version answers before the module is checked for being active,
// and only the modules the run would book now are checked: a deactivated
// module of the planned version holds nothing back by itself.
func TestAPlannedChangeAnswersBeforeAnInactiveModule(t *testing.T) {
	t.Parallel()
	school := enrollmentSchool()
	short, full := school.offerings[1], school.offerings[2]
	full.Active = false
	school.offerings[2] = full
	row := planEnrollmentRow(school, plannedCorrection("16:30"), nil, boundChildren{}, enrollmentToday)
	assert.Equal(t, carecontract.EnrollmentReasonPlannedChange, row.Reason, "the module of the planned version is not booked now")

	short.Active = false
	school.offerings[1] = short
	row = planEnrollmentRow(school, plannedCorrection("16:30"), nil, boundChildren{}, enrollmentToday)
	assert.Equal(t, carecontract.EnrollmentReasonPlannedChange, row.Reason, "the planned change answers first")
}

// The modules of the version in force ended, and the contract has a version
// that starts after today in the same phase. The stored enrollment does not
// carry that version: the row is held as a planned change, not as an
// application that differs.
func TestAnEndedContractWithAPlannedVersionIsAPlannedChange(t *testing.T) {
	t.Parallel()
	contract, stored := endedContract()
	planned := contract.Versions[0]
	planned.ID, planned.Number, planned.EffectiveFrom = 32, 2, *date(2031, 7, 15)
	planned.Services = []carecontract.Service{importedService("mon", 2, "Ganztag", "16:30")}
	contract.Versions[0].EndsOn = date(2031, 7, 14)
	contract.Versions, contract.NextNumber = append(contract.Versions, planned), 3

	row := planEnrollmentRow(enrollmentSchool(), contract, []carecontract.Application{stored}, boundChildren{}, *date(2031, 7, 1))
	assert.Equal(t, carecontract.EnrollmentHeld, row.Status)
	assert.Equal(t, carecontract.EnrollmentReasonPlannedChange, row.Reason)
	assert.Equal(t, ident.ID(plannedRequestChild), row.EnrollmentChildID, "the row names the enrollment it cannot be bound to yet")
}

// A row names the silent enrollment of its child that has no contract: a
// ready row binds it; a held row is stuck with it. An application a parent
// submitted, and one that has a contract, is never named so.
func TestARowNamesTheSilentEnrollmentWithoutAContract(t *testing.T) {
	t.Parallel()
	contract, stored := endedContract()
	today := *date(2031, 7, 1)
	ready := planEnrollmentRow(enrollmentSchool(), contract, []carecontract.Application{stored}, boundChildren{}, today)
	require.Equal(t, carecontract.EnrollmentReady, ready.Status)
	assert.Equal(t, ident.ID(plannedRequestChild), ready.EnrollmentChildID)

	// After the service of the phase nothing binds the enrollment any more.
	over := planEnrollmentRow(enrollmentSchool(), contract, []carecontract.Application{stored}, boundChildren{}, *date(2031, 9, 1))
	assert.Equal(t, carecontract.EnrollmentHeld, over.Status)
	assert.Equal(t, carecontract.EnrollmentReasonCareEnds, over.Reason)
	assert.Equal(t, ident.ID(plannedRequestChild), over.EnrollmentChildID, "the enrollment that stays unbound is named")

	parents := stored
	parents.ContractImport = false
	assert.Zero(t, planEnrollmentRow(enrollmentSchool(), contract, []carecontract.Application{parents}, boundChildren{}, *date(2031, 9, 1)).EnrollmentChildID,
		"an application of the parents is no silent enrollment")
	assert.Zero(t, planEnrollmentRow(enrollmentSchool(), contract, []carecontract.Application{stored}, boundChildren{plannedRequestChild: 3},
		*date(2031, 9, 1)).EnrollmentChildID, "an enrollment that has a contract is not stuck")

	// The child has a second imported contract, which follows this one. The
	// orphaned enrollment was made for the first: the successor is held, not
	// stuck with an enrollment that is not its own.
	successor := contract
	successor.ID = contract.ID + 1
	held := planEnrollmentRow(enrollmentSchool(), successor, []carecontract.Application{stored}, boundChildren{}, *date(2031, 9, 1))
	assert.Equal(t, carecontract.EnrollmentHeld, held.Status)
	assert.Zero(t, held.EnrollmentChildID, "the enrollment of another contract of the child is not named")
}

// A run enrolled the child in the phase of the contract's module and stopped
// before the binding. The office then corrected the unbound contract to a
// module of another phase that runs today. The plan finds no application of
// the child in that phase, but the contract has its silent enrollment: the
// row never enrolls the child a second time. It is held and names the
// enrollment; once the contract books the first phase again, the row binds
// exactly that enrollment.
func TestAContractWithAnUnboundSilentEnrollmentIsNeverEnrolledAnew(t *testing.T) {
	t.Parallel()
	student := plannedStudent
	stored := carecontract.Application{RequestChildID: plannedRequestChild, StudentID: &student, ContractImport: true,
		ImportContractID: enrollableContract().ID,
		Bookings:         []carecontract.Booking{{CareOfferingID: 1, Days: []string{"mon", "tue"}, ValidFrom: date(2030, 8, 1), ValidUntil: date(2031, 8, 1)}}}
	school := enrollmentSchool()
	other := school.offerings[4]
	// The other phase overlaps the first: its service runs today as well.
	other.ServiceStart, other.ServiceEnd = date(2030, 8, 1), date(2031, 7, 31)
	school.offerings[4] = other
	corrected := enrollableContract()
	corrected.Versions[0].Services = []carecontract.Service{importedService("mon", 4, "Ganztag 2031/32", "16:30")}

	without := planEnrollmentRow(school, corrected, nil, boundChildren{}, enrollmentToday)
	require.Equal(t, carecontract.EnrollmentReady, without.Status, "without the enrollment the corrected contract is enrolled in the other phase")
	require.Equal(t, ident.ID(71), without.PhaseID)

	row := planEnrollmentRow(school, corrected, []carecontract.Application{stored}, boundChildren{}, enrollmentToday)
	assert.Equal(t, carecontract.EnrollmentHeld, row.Status, "no second enrollment beside the approved one")
	assert.Equal(t, carecontract.EnrollmentReasonHasApplication, row.Reason)
	assert.Equal(t, ident.ID(plannedRequestChild), row.EnrollmentChildID)
	assert.Equal(t, ident.ID(plannedRequestChild), row.RequestChildID, "the row names the enrollment that holds it back")
	assert.Empty(t, row.Token, "a held row has no token a binding could take")

	// The enrollment of another contract of the child holds nothing back.
	foreign := stored
	foreign.ImportContractID++
	assert.Equal(t, carecontract.EnrollmentReady, planEnrollmentRow(school, corrected, []carecontract.Application{foreign}, boundChildren{}, enrollmentToday).Status)

	// Uncorrected, the contract is bound to exactly its enrollment.
	bind := planEnrollmentRow(school, enrollableContract(), []carecontract.Application{stored}, boundChildren{}, enrollmentToday)
	require.Equal(t, carecontract.EnrollmentReady, bind.Status, bind.Reason)
	assert.Equal(t, ident.ID(plannedRequestChild), bind.RequestChildID)
	assert.NotEmpty(t, bind.ApplicationBookings, "it confirms the stored application, it does not enroll")
}
