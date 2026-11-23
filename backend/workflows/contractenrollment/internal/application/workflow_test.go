package application

import (
	"context"
	"fmt"
	"slices"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/modules/carecontract"
	"github.com/moto-ogs/project-phoenix/modules/enrollment"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
	"github.com/moto-ogs/project-phoenix/workflows/contractenrollment"
	"github.com/moto-ogs/project-phoenix/workflows/contractenrollment/ports"
)

const (
	fakeSchool       int64 = 10
	fakeOrganization int64 = 1
	fakeAccount      int64 = 5

	contractMia, contractBen, contractLia, contractOle, contractTom, contractKai int64 = 101, 102, 103, 104, 105, 106
	studentMia, studentBen, studentLia, studentOle, studentKai                   int64 = 201, 202, 203, 204, 206
	childBen, childLia, childOle, childKai, enrolledMia                          int64 = 302, 303, 304, 306, 401
)

var fakeActor = contractenrollment.Actor{OrganizationID: fakeOrganization, AccountID: fakeAccount}

// fakeOwners stands in for every owner port and records the transactions
// and calls in order.
type fakeOwners struct {
	trail               []string
	inTraeger, inSchool int64
	plan                carecontract.EnrollmentPlan
	// answer is what the school's enrollment answers per contract; the
	// answers come back in reverse order of the rows asked for.
	answer map[int64]enrollment.ContractEnrollmentResult
	// lockedAnswer is what the enrollment answers per contract under its
	// locks when the school changed since the check; the check's answer
	// when it names none.
	lockedAnswer map[int64]enrollment.ContractEnrollmentResult
	enrolled     []enrollment.ContractEnrollment
	bindings     []carecontract.ApplicationBinding
	// bindingStatus is what the binding answers per contract, bound when
	// it names none.
	bindingStatus map[int64]string
	access        []ports.SchoolRead
	unbound       [2]int64
	// transferred tells that an operator gave the school to another Träger
	// after the list of the Träger's schools was read.
	transferred bool
}

func (f *fakeOwners) note(format string, args ...any) {
	f.trail = append(f.trail, fmt.Sprintf(format, args...))
}

func (f *fakeOwners) WithinTraeger(ctx context.Context, organizationID int64, fn func(context.Context) error) error {
	if f.inTraeger != 0 || f.inSchool != 0 {
		return fmt.Errorf("nested transaction")
	}
	f.inTraeger = organizationID
	defer func() { f.inTraeger = 0 }()
	f.note("träger %d", organizationID)
	return fn(ctx)
}

func (f *fakeOwners) WithinSchool(ctx context.Context, schoolID int64, fn func(context.Context) error) error {
	if f.inTraeger != 0 || f.inSchool != 0 {
		return fmt.Errorf("nested transaction")
	}
	f.inSchool = schoolID
	defer func() { f.inSchool = 0 }()
	f.note("school %d", schoolID)
	return fn(ctx)
}

func (f *fakeOwners) TraegerSchoolIDs(context.Context, int64) ([]int64, error) {
	return []int64{fakeSchool}, nil
}

func (f *fakeOwners) HoldTraegerSchool(_ context.Context, organizationID, schoolID int64) (bool, error) {
	f.note("hold in school %d", f.inSchool)
	return !f.transferred && organizationID == fakeOrganization && schoolID == fakeSchool, nil
}

func (f *fakeOwners) EnrollmentContracts(_ context.Context, _ carecontract.Reviewer, schoolID int64) (carecontract.EnrollmentRead, error) {
	f.note("contracts in träger %d", f.inTraeger)
	return carecontract.EnrollmentRead{SchoolID: schoolID}, nil
}

func (f *fakeOwners) EnrollmentPlans(context.Context, carecontract.EnrollmentRead) (carecontract.EnrollmentPlan, error) {
	f.note("plan in school %d", f.inSchool)
	return f.plan, nil
}

func (f *fakeOwners) BindApplications(_ context.Context, _ carecontract.Reviewer, _ int64, bindings []carecontract.ApplicationBinding) ([]carecontract.ApplicationBindingResult, error) {
	f.note("bind in träger %d", f.inTraeger)
	f.bindings = bindings
	results := make([]carecontract.ApplicationBindingResult, len(bindings))
	for i, binding := range bindings {
		status := f.bindingStatus[binding.ContractID.Int64()]
		if status == "" {
			status = carecontract.BindingBound
		}
		results[i] = carecontract.ApplicationBindingResult{ContractID: binding.ContractID, Status: status}
	}
	return results, nil
}

func (f *fakeOwners) UnbindApplication(_ context.Context, _ carecontract.Reviewer, contractID, requestChildID int64) (int64, error) {
	f.note("unbind in träger %d", f.inTraeger)
	f.unbound = [2]int64{contractID, requestChildID}
	return fakeSchool, nil
}

func (f *fakeOwners) answers(inputs []enrollment.ContractEnrollment, locked bool) []enrollment.ContractEnrollmentResult {
	results := []enrollment.ContractEnrollmentResult{}
	for _, input := range slices.Backward(inputs) {
		result := f.answer[input.ContractID]
		if later, changed := f.lockedAnswer[input.ContractID]; locked && changed {
			result = later
		}
		result.ContractID, result.StudentID = input.ContractID, input.StudentID
		results = append(results, result)
	}
	return results
}

func (f *fakeOwners) CheckContractChildren(_ context.Context, inputs []enrollment.ContractEnrollment) ([]enrollment.ContractEnrollmentResult, error) {
	f.note("check in school %d", f.inSchool)
	return f.answers(inputs, false), nil
}

func (f *fakeOwners) EnrollContractChildren(_ context.Context, inputs []enrollment.ContractEnrollment) ([]enrollment.ContractEnrollmentResult, error) {
	f.note("enroll in school %d", f.inSchool)
	f.enrolled = inputs
	return f.answers(inputs, true), nil
}

func (f *fakeOwners) SchoolChildren(_ context.Context, studentIDs []int64) ([]ports.Child, error) {
	f.note("children in school %d", f.inSchool)
	birth := calendar.NewDate(2019, 5, 3)
	children := []ports.Child{}
	for _, id := range studentIDs {
		if id != studentOle {
			children = append(children, ports.Child{StudentID: id, FirstName: fmt.Sprintf("Kind %d", id), LastName: "Akte", BirthDate: &birth})
		}
	}
	return children, nil
}

func (f *fakeOwners) RecordAccess(_ context.Context, read ports.SchoolRead) error {
	f.note("access in school %d", f.inSchool)
	f.access = append(f.access, read)
	return nil
}

func (f *fakeOwners) workflow(t *testing.T) *Workflow {
	t.Helper()
	workflow, err := New(ports.Dependencies{Contracts: f, SchoolEnrollments: f, Schools: f, Children: f, Access: f, Runtime: f,
		Fingerprint: func(content []byte) string { return fmt.Sprintf("%d:%x", len(content), content[len(content)/2:]) }})
	require.NoError(t, err)
	return workflow
}

func booking(offering int64) carecontract.EnrollmentBooking {
	return carecontract.EnrollmentBooking{CareOfferingID: ident.ID(offering), ModuleName: "OGS", Days: []string{"mon"},
		ValidFrom: calendar.NewDate(2027, 8, 1), ValidUntil: calendar.NewDate(2028, 8, 1)}
}

// newFakeOwners is a school with six imported contracts: Mia is enrolled,
// Ben is bound to the application he has, Lia has an application the school
// did not accept yet, Ole's enrollment is stuck, Tom has no child record and
// Kai is bound already.
func newFakeOwners() *fakeOwners {
	ready := func(contract, student int64) carecontract.EnrollmentPlanRow {
		return carecontract.EnrollmentPlanRow{ContractID: ident.ID(contract), Status: carecontract.EnrollmentReady, StudentID: ident.ID(student),
			ChildFirstName: "Vertragskind", ChildLastName: fmt.Sprint(contract), PhaseID: 7, PhaseName: "Schuljahr 2027/28",
			PhaseStart: calendar.NewDate(2027, 8, 1), PhaseEnd: calendar.NewDate(2028, 7, 31),
			Bookings: []carecontract.EnrollmentBooking{booking(70)}, Changes: []carecontract.EnrollmentChange{}, Token: fmt.Sprintf("token-%d", contract)}
	}
	ben := ready(contractBen, studentBen)
	ben.RequestChildID, ben.ApplicationBookings, ben.ProvedOn = ident.ID(childBen), []carecontract.EnrollmentBooking{booking(71)}, calendar.NewDate(2027, 9, 6)
	return &fakeOwners{
		plan: carecontract.EnrollmentPlan{SchoolID: ident.ID(fakeSchool), Rows: []carecontract.EnrollmentPlanRow{
			ready(contractMia, studentMia), ben, ready(contractLia, studentLia),
			{ContractID: ident.ID(contractOle), Status: carecontract.EnrollmentHeld, Reason: carecontract.EnrollmentReasonPhaseEnded,
				StudentID: ident.ID(studentOle), EnrollmentChildID: ident.ID(childOle)},
			{ContractID: ident.ID(contractTom), Status: carecontract.EnrollmentUnlinked},
			{ContractID: ident.ID(contractKai), Status: carecontract.EnrollmentDone, StudentID: ident.ID(studentKai), RequestChildID: ident.ID(childKai)},
		}},
		answer: map[int64]enrollment.ContractEnrollmentResult{
			contractMia: {Status: enrollment.ContractEnrollmentEnrolled, RequestChildID: enrolledMia},
			contractBen: {Status: enrollment.ContractEnrollmentExisting, RequestChildID: childBen},
			contractLia: {Status: enrollment.ContractEnrollmentHasApplication, RequestChildID: childLia},
		},
		bindingStatus: map[int64]string{},
	}
}

func rowOf(t *testing.T, rows []contractenrollment.EnrollmentRow, contract int64) contractenrollment.EnrollmentRow {
	t.Helper()
	for _, row := range rows {
		if row.ContractID.Int64() == contract {
			return row
		}
	}
	require.Failf(t, "row missing", "contract %d", contract)
	return contractenrollment.EnrollmentRow{}
}

func TestPreviewMergesPlanAndEnrollmentAndLogsTheRead(t *testing.T) {
	t.Parallel()
	f := newFakeOwners()
	preview, err := f.workflow(t).Preview(context.Background(), fakeActor, fakeSchool)
	require.NoError(t, err)

	assert.Equal(t, []string{"träger 1", "contracts in träger 1", "school 10", "hold in school 10", "plan in school 10", "check in school 10",
		"children in school 10", "access in school 10"}, f.trail, "the Träger transaction ends before the school's begins")
	assert.Empty(t, f.enrolled, "a preview enrolls nobody")
	assert.Empty(t, f.bindings, "a preview binds nothing")
	require.Len(t, f.access, 1, "the read of the school is written into its access log in the same transaction")
	assert.Equal(t, []int64{contractMia, contractBen, contractLia, contractOle, contractTom, contractKai}, f.access[0].ContractIDs)
	assert.Equal(t, []int64{studentMia, studentBen, studentLia, studentOle, studentKai}, f.access[0].StudentIDs)

	assert.NotEmpty(t, preview.Fingerprint)
	assert.Equal(t, contractenrollment.EnrollmentRowCounts{Ready: 2, Done: 1, Unlinked: 1, Held: 1, Stuck: 1}, preview.Counts)
	mia := rowOf(t, preview.Rows, contractMia)
	assert.Equal(t, contractenrollment.RowReady, mia.Status)
	assert.Equal(t, contractenrollment.ActionEnroll, mia.Action)
	require.NotNil(t, mia.Student, "the child record stands beside the child of the contract")
	assert.Equal(t, "Kind 201", mia.Student.FirstName)
	assert.Equal(t, "Vertragskind", mia.ContractChild.FirstName)
	assert.Equal(t, ident.ID(fakeSchool), mia.SchoolID)
	assert.Equal(t, "Schuljahr 2027/28", mia.PhaseName)
	assert.Equal(t, ident.ID(70), mia.Bookings[0].CareOfferingID)

	ben := rowOf(t, preview.Rows, contractBen)
	assert.Equal(t, contractenrollment.ActionBind, ben.Action)
	assert.Equal(t, ident.ID(childBen), ben.RequestChildID)

	lia := rowOf(t, preview.Rows, contractLia)
	assert.Equal(t, contractenrollment.RowHeld, lia.Status, "the answer of the school's enrollment goes before the plan")
	assert.Equal(t, carecontract.EnrollmentReasonHasApplication, lia.Reason)
	assert.Equal(t, ident.ID(childLia), lia.RequestChildID)

	ole := rowOf(t, preview.Rows, contractOle)
	assert.Equal(t, contractenrollment.RowStuck, ole.Status, "an enrollment that can no longer be bound has its own status")
	assert.Equal(t, carecontract.EnrollmentReasonPhaseEnded, ole.Reason)
	assert.Equal(t, ident.ID(childOle), ole.RequestChildID)
	assert.Nil(t, ole.Student, "a child record the school no longer has is not shown")

	assert.Equal(t, contractenrollment.RowUnlinked, rowOf(t, preview.Rows, contractTom).Status)
	assert.Equal(t, contractenrollment.RowDone, rowOf(t, preview.Rows, contractKai).Status)
}

func TestPreviewHoldsAnApplicationThatIsNotWhatThePlanProved(t *testing.T) {
	t.Parallel()
	f := newFakeOwners()
	f.answer[contractBen] = enrollment.ContractEnrollmentResult{Status: enrollment.ContractEnrollmentChanged}
	f.answer[contractMia] = enrollment.ContractEnrollmentResult{Status: enrollment.ContractEnrollmentRefused, Reason: enrollment.ContractEnrollmentRosterBound}
	preview, err := f.workflow(t).Preview(context.Background(), fakeActor, fakeSchool)
	require.NoError(t, err)
	ben := rowOf(t, preview.Rows, contractBen)
	assert.Equal(t, contractenrollment.RowHeld, ben.Status)
	assert.Equal(t, contractenrollment.ReasonChanged, ben.Reason)
	mia := rowOf(t, preview.Rows, contractMia)
	assert.Equal(t, contractenrollment.RowHeld, mia.Status)
	assert.Equal(t, enrollment.ContractEnrollmentRosterBound, mia.Reason, "the refusal of the school's enrollment is the reason of the row")
}

func TestRunEnrollsInTheSchoolAndBindsWhatTheEnrollmentAnswered(t *testing.T) {
	t.Parallel()
	f := newFakeOwners()
	workflow := f.workflow(t)
	preview, err := workflow.Preview(context.Background(), fakeActor, fakeSchool)
	require.NoError(t, err)
	f.trail = nil
	f.bindingStatus[contractBen] = carecontract.BindingChanged

	run, err := workflow.Run(context.Background(), fakeActor, fakeSchool, preview.Fingerprint)
	require.NoError(t, err)
	assert.Equal(t, []string{"träger 1", "contracts in träger 1", "school 10", "hold in school 10", "plan in school 10", "check in school 10",
		"children in school 10", "access in school 10", "enroll in school 10", "träger 1", "bind in träger 1"}, f.trail,
		"read, school and binding are three transactions, one after the other")

	require.Len(t, f.enrolled, 2, "only the rows the preview showed as ready go through the school's enrollment")
	assert.Equal(t, contractMia, f.enrolled[0].ContractID)
	assert.Equal(t, enrollment.ContractEnrollment{StudentID: studentBen, PhaseID: 7, ContractID: contractBen,
		ServiceStart: calendar.NewDate(2027, 8, 1), ServiceEnd: calendar.NewDate(2028, 7, 31), RequestChildID: childBen,
		ProvedOn: calendar.NewDate(2027, 9, 6), ActorAccountID: fakeAccount,
		Bookings: []enrollment.ContractBooking{{CareOfferingID: 71, Days: []string{"mon"}, ValidFrom: calendar.NewDate(2027, 8, 1),
			ValidUntil: calendar.NewDate(2028, 8, 1)}}}, f.enrolled[1],
		"a row that names an application asks for its confirmation with the bookings the plan proved")

	// The fake answers in reverse order: an answer is related to its row by
	// contract and child record, never by its position.
	assert.Equal(t, []carecontract.ApplicationBinding{
		{ContractID: ident.ID(contractMia), StudentID: ident.ID(studentMia), RequestChildID: ident.ID(enrolledMia), Token: "token-101",
			Enrollment: carecontract.EnrollmentAnswerEnrolled},
		{ContractID: ident.ID(contractBen), StudentID: ident.ID(studentBen), RequestChildID: ident.ID(childBen), Token: "token-102",
			Enrollment: carecontract.EnrollmentAnswerExisting},
	}, f.bindings, "only what the enrollment answered as enrolled or existing is bound, with that answer")

	mia := rowOf(t, run.Rows, contractMia)
	assert.Equal(t, contractenrollment.RowDone, mia.Status)
	assert.Equal(t, contractenrollment.ActionEnroll, mia.Action)
	assert.Equal(t, ident.ID(enrolledMia), mia.RequestChildID)
	ben := rowOf(t, run.Rows, contractBen)
	assert.Equal(t, contractenrollment.RowChanged, ben.Status, "a contract the binding refuses is changed, not done")
	assert.Equal(t, contractenrollment.RowHeld, rowOf(t, run.Rows, contractLia).Status)
	assert.Equal(t, contractenrollment.RowStuck, rowOf(t, run.Rows, contractOle).Status)
	assert.Equal(t, contractenrollment.EnrollmentRowCounts{Done: 2, Unlinked: 1, Held: 1, Stuck: 1, Changed: 1}, run.Counts)
	assert.True(t, run.Changed, "the run enrolled a child and bound a contract")
}

// A run changed something when the school enrolled a child or a contract
// was bound; finding an enrollment and a binding that exist is no change.
func TestARunSaysWhetherItCommittedSomething(t *testing.T) {
	t.Parallel()
	for name, tc := range map[string]struct {
		mia     string
		binding string
		changed bool
	}{
		"enrolled, the binding refused": {enrollment.ContractEnrollmentEnrolled, carecontract.BindingChanged, true},
		"found and bound":               {enrollment.ContractEnrollmentExisting, carecontract.BindingBound, true},
		"found, bound before":           {enrollment.ContractEnrollmentExisting, carecontract.BindingDone, false},
		"found, the binding refused":    {enrollment.ContractEnrollmentExisting, carecontract.BindingChanged, false},
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			f := newFakeOwners()
			f.answer[contractMia] = enrollment.ContractEnrollmentResult{Status: tc.mia, RequestChildID: enrolledMia}
			f.bindingStatus[contractMia], f.bindingStatus[contractBen] = tc.binding, carecontract.BindingDone
			workflow := f.workflow(t)
			preview, err := workflow.Preview(context.Background(), fakeActor, fakeSchool)
			require.NoError(t, err)
			run, err := workflow.Run(context.Background(), fakeActor, fakeSchool, preview.Fingerprint)
			require.NoError(t, err)
			assert.Equal(t, tc.changed, run.Changed)
		})
	}
}

// The plan calls Lia ready, the check of the school's enrollment held her
// back (a pending application), and the office confirmed that preview. The
// school rejects the application before the enrollment reads it under its
// locks: there it would enroll her now. The run must not ask.
func TestRunNeverEnrollsARowThePreviewHeldBack(t *testing.T) {
	t.Parallel()
	f := newFakeOwners()
	workflow := f.workflow(t)
	preview, err := workflow.Preview(context.Background(), fakeActor, fakeSchool)
	require.NoError(t, err)
	require.Equal(t, contractenrollment.RowHeld, rowOf(t, preview.Rows, contractLia).Status)
	f.lockedAnswer = map[int64]enrollment.ContractEnrollmentResult{
		contractLia: {Status: enrollment.ContractEnrollmentEnrolled, RequestChildID: 499}}

	run, err := workflow.Run(context.Background(), fakeActor, fakeSchool, preview.Fingerprint)
	require.NoError(t, err)
	for _, input := range f.enrolled {
		assert.NotEqual(t, contractLia, input.ContractID, "a row held in the preview is never passed to the enrollment")
	}
	for _, binding := range f.bindings {
		assert.NotEqual(t, ident.ID(contractLia), binding.ContractID, "and never bound")
	}
	assert.Equal(t, rowOf(t, preview.Rows, contractLia), rowOf(t, run.Rows, contractLia), "the row stays what the preview showed")
	mia := rowOf(t, run.Rows, contractMia)
	assert.Equal(t, contractenrollment.RowDone, mia.Status)
	assert.Empty(t, mia.Reason, "a done row carries no reason")
}

// With every ready row held back by the check, the run asks the enrollment
// for nothing and binds nothing.
func TestRunWithoutAReadyPreviewRowWritesNothing(t *testing.T) {
	t.Parallel()
	f := newFakeOwners()
	refused := enrollment.ContractEnrollmentResult{Status: enrollment.ContractEnrollmentRefused, Reason: enrollment.ContractEnrollmentRosterBound}
	f.answer[contractMia], f.answer[contractBen] = refused, refused
	workflow := f.workflow(t)
	preview, err := workflow.Preview(context.Background(), fakeActor, fakeSchool)
	require.NoError(t, err)
	f.trail = nil

	run, err := workflow.Run(context.Background(), fakeActor, fakeSchool, preview.Fingerprint)
	require.NoError(t, err)
	assert.NotContains(t, f.trail, "enroll in school 10")
	assert.NotContains(t, f.trail, "bind in träger 1")
	assert.Equal(t, preview.Rows, run.Rows)
	assert.False(t, run.Changed)
}

func TestRunRefusesAPreviewThatChanged(t *testing.T) {
	t.Parallel()
	f := newFakeOwners()
	workflow := f.workflow(t)
	preview, err := workflow.Preview(context.Background(), fakeActor, fakeSchool)
	require.NoError(t, err)
	// The contract names its child otherwise since the office looked.
	f.plan.Rows[0].ChildLastName = "Anders"

	_, err = workflow.Run(context.Background(), fakeActor, fakeSchool, preview.Fingerprint)
	require.ErrorIs(t, err, contractenrollment.ErrPreviewChanged)
	assert.Empty(t, f.enrolled, "a changed preview enrolls nobody")
	assert.Empty(t, f.bindings)

	_, err = workflow.Run(context.Background(), fakeActor, fakeSchool, "")
	require.ErrorIs(t, err, contractenrollment.ErrPreviewChanged, "a run without a fingerprint confirms nothing")
}

func TestASchoolOfAnotherTraegerIsRefusedBeforeAnythingIsRead(t *testing.T) {
	t.Parallel()
	f := newFakeOwners()
	_, err := f.workflow(t).Preview(context.Background(), fakeActor, fakeSchool+1)
	require.ErrorIs(t, err, carecontract.ErrSchoolOutsideTraeger)
	_, err = f.workflow(t).Run(context.Background(), fakeActor, fakeSchool+1, "x")
	require.ErrorIs(t, err, carecontract.ErrSchoolOutsideTraeger)
	assert.Empty(t, f.trail, "no transaction opens for a school of another Träger")
}

// The school was the Träger's when the request began and is another
// Träger's when its tenant transaction opens: nothing of the school is read,
// logged or written.
func TestASchoolGivenAwayDuringTheRequestIsRefusedInItsTransaction(t *testing.T) {
	t.Parallel()
	f := newFakeOwners()
	workflow := f.workflow(t)
	preview, err := workflow.Preview(context.Background(), fakeActor, fakeSchool)
	require.NoError(t, err)
	f.trail, f.access, f.transferred = nil, nil, true

	_, err = workflow.Preview(context.Background(), fakeActor, fakeSchool)
	require.ErrorIs(t, err, carecontract.ErrSchoolOutsideTraeger)
	_, err = workflow.Run(context.Background(), fakeActor, fakeSchool, preview.Fingerprint)
	require.ErrorIs(t, err, carecontract.ErrSchoolOutsideTraeger)
	assert.Equal(t, []string{"träger 1", "contracts in träger 1", "school 10", "hold in school 10",
		"träger 1", "contracts in träger 1", "school 10", "hold in school 10"}, f.trail,
		"the school is held first in its transaction, and nothing follows")
	assert.Empty(t, f.access)
	assert.Empty(t, f.enrolled)
	assert.Empty(t, f.bindings)
}

func TestUnbindRunsInOneTraegerTransaction(t *testing.T) {
	t.Parallel()
	f := newFakeOwners()
	require.NoError(t, f.workflow(t).Unbind(context.Background(), fakeActor, contractKai, childKai))
	assert.Equal(t, []string{"träger 1", "unbind in träger 1"}, f.trail, "the way back reads and writes nothing of the school")
	assert.Equal(t, [2]int64{contractKai, childKai}, f.unbound)
}
