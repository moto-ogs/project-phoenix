package enrollmenthttp_test

import (
	"context"
	"testing"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/careplan"
	capability "github.com/moto-ogs/project-phoenix/modules/enrollment"
	enrollmentCompose "github.com/moto-ogs/project-phoenix/modules/enrollment/compose"
	enrollmentAPI "github.com/moto-ogs/project-phoenix/modules/enrollment/http"
	offeringContract "github.com/moto-ogs/project-phoenix/modules/enrollment/offeringcontract"
	"github.com/moto-ogs/project-phoenix/modules/securityruntime"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/tenant"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

// The enrollment of the children of imported care contracts (#7760, ADR
// 0308) against the real database: what it writes, what it leaves alone and
// what it refuses.

// countingBookings counts the two Care Plan calls that reach the guardians
// in the parents portal: the announcement of the pickup projection and the
// offering adjustment that ends in it.
type countingBookings struct {
	TestDecisionBookings
	announcements, adjustments int
}

func (b *countingBookings) ReconcileOfferingPickupForStudents(ctx context.Context, studentIDs []int64) error {
	b.announcements++
	return b.TestDecisionBookings.ReconcileOfferingPickupForStudents(ctx, studentIDs)
}

func (b *countingBookings) AdjustOfferings(ctx context.Context, in careplan.OfferingAdjustment) (*careplan.OfferingAdjustmentResult, error) {
	b.adjustments++
	return b.TestDecisionBookings.AdjustOfferings(ctx, in)
}

// contractEnrollmentEnv is the decision harness with a care offering of the
// phase that feeds a roster, and the decision flow over counting bookings.
type contractEnrollmentEnv struct {
	*decisionTestEnv
	owner    *TestDecisions
	bookings *countingBookings
	offering *offeringContract.CareOfferingRecord
	groupID  int64
	contract int64
}

func setupContractEnrollment(t *testing.T) *contractEnrollmentEnv {
	t.Helper()
	env := setupDecisionTest(t)
	group := testpkg.CreateTestActivityGroup(t, env.db, "ContractEnrollment")
	offering := createAdjustmentCareOfferingWith(t, env, "Ganztag "+t.Name(), func(o *offeringContract.CareOfferingRecord) {
		o.ActivityGroupID, o.CountsAsCare, o.PickupTimes = &group.ID, true, carePickupTimes("mon", "tue", "wed", "thu", "fri")
	})
	bookings := &countingBookings{TestDecisionBookings: env.bookings}
	return &contractEnrollmentEnv{decisionTestEnv: env, bookings: bookings, offering: offering, groupID: group.ID,
		owner:    newDecisionsForTestWithBookings(t, env.rolloverTestEnv, bookings, nil, nil, nil, nil),
		contract: testpkg.UniqueTestTenantID(t)}
}

// student is an active child record with a date of birth and a guardian.
func (e *contractEnrollmentEnv) student(t *testing.T, firstName string) *testpkg.Student {
	t.Helper()
	student := testpkg.CreateTestStudent(t, e.db, firstName, "Vertrag", "1a")
	_, err := e.db.ExecContext(testpkg.Ctx(t), `UPDATE users.persons SET birthday = DATE '2018-04-15' WHERE id = ?`, student.PersonID)
	require.NoError(t, err)
	return student
}

func (e *contractEnrollmentEnv) booking(days ...string) capability.ContractBooking {
	return capability.ContractBooking{CareOfferingID: e.offering.ID, Days: days,
		ValidFrom: calendar.Date(e.sourcePhase.ServiceStartDate), ValidUntil: calendar.Date(e.sourcePhase.ServiceEndDate).AddDays(1)}
}

func (e *contractEnrollmentEnv) input(studentID int64, bookings ...capability.ContractBooking) capability.ContractEnrollment {
	return capability.ContractEnrollment{StudentID: studentID, PhaseID: e.sourcePhase.ID, ContractID: e.contract,
		Bookings: bookings, ActorAccountID: e.creatorID}
}

func (e *contractEnrollmentEnv) enroll(t *testing.T, inputs ...capability.ContractEnrollment) []capability.ContractEnrollmentResult {
	t.Helper()
	results, err := testpkg.TenantQuery1(t, testpkg.Ctx(t), e.db, e.owner.EnrollContractChildren, inputs)
	require.NoError(t, err)
	return results
}

func (e *contractEnrollmentEnv) check(t *testing.T, inputs ...capability.ContractEnrollment) []capability.ContractEnrollmentResult {
	t.Helper()
	results, err := testpkg.TenantQuery1(t, testpkg.Ctx(t), e.db, e.owner.CheckContractChildren, inputs)
	require.NoError(t, err)
	return results
}

func (e *contractEnrollmentEnv) count(t *testing.T, query string, args ...any) int {
	t.Helper()
	var n int
	require.NoError(t, e.db.NewRaw(query, args...).Scan(testpkg.Ctx(t), &n))
	return n
}

// silentTables are the rows of the school a silent enrollment must leave as
// they are: the child record, the person, guardians, their relationships
// and accesses, consents, the weekly plans, and everything that sends.
var silentTables = []string{
	"users.student_profiles", "users.student_school_memberships", "users.student_care_profiles", "users.persons",
	"users.guardian_profiles", "users.guardian_phone_numbers", "users.student_guardian_relationships",
	"auth.guardian_student_access", "auth.account_tenants", "users.privacy_consents", "audit.student_consent_changes",
	"audit.student_field_edits", "users.student_care_exits", "schedule.student_pickup_schedules",
	"schedule.student_arrival_schedules", "schedule.student_pickup_exceptions", "platform.email_outbox", "platform.push_outbox",
	"auth.guardian_invitations", "auth.invitation_tokens",
}

// snapshot is every row of the silent tables of the test's school, as text.
func (e *contractEnrollmentEnv) snapshot(t *testing.T) map[string]string {
	t.Helper()
	rows := make(map[string]string, len(silentTables))
	for _, table := range silentTables {
		var text string
		require.NoError(t, e.db.NewRaw(`SELECT COALESCE(string_agg(row.text, E'\n' ORDER BY row.text), '') FROM (
			SELECT t::text AS text FROM `+table+` AS t WHERE t.tenant_id = ?) AS row`, testpkg.Tenant(t)).Scan(testpkg.Ctx(t), &text), table)
		rows[table] = text
	}
	return rows
}

// The enrollment writes a request with one approved child linked to the
// child record that exists, its bookings and the roster an approval derives.
// It changes nothing else of the school and sends nothing; a repeated call
// writes nothing twice; and the child is then an approved child like any
// other: it occupies its place, the contract of the Träger reads it, and the
// office changes its bookings on the usual way.
func TestContractEnrollmentEnrollsAnExistingChildSilently(t *testing.T) {
	t.Parallel()
	e := setupContractEnrollment(t)
	ctx := testpkg.Ctx(t)
	student := e.student(t, "Lina")
	guardian := testpkg.CreateTestGuardianProfileNamed(t, e.db, "Erika", "Vertrag", "contract-enrollment-guardian")
	testpkg.CreateTestStudentGuardianLink(t, e.db, student.ID, guardian.ID, "primary_guardian")
	account := testpkg.CreateTestAccountWithPassword(t, e.db, *guardian.Email, testpkg.NewTestPassword())
	before := e.snapshot(t)
	mails := len(e.outbox.entries)

	input := e.input(student.ID, e.booking("mon", "wed"))
	assert.Equal(t, capability.ContractEnrollmentEnrolled, e.check(t, input)[0].Status)
	assert.Zero(t, e.count(t, `SELECT COUNT(*) FROM enrollment.requests WHERE tenant_id = ? AND submission_source = ?`,
		testpkg.Tenant(t), capability.RequestSourceContractImport), "a check writes nothing")

	counter := testpkg.CaptureQueriesForContext(t, e.db)
	results, err := testpkg.TenantQuery1(t, counter.Context(ctx), e.db, e.owner.EnrollContractChildren, []capability.ContractEnrollment{input})
	require.NoError(t, err)
	t.Logf("contract enrollment: %d statements for one child", len(counter.Queries()))
	require.Len(t, results, 1)
	result := results[0]
	require.Equal(t, capability.ContractEnrollmentEnrolled, result.Status)
	assert.Equal(t, e.contract, result.ContractID)
	assert.Equal(t, student.ID, result.StudentID)

	request, err := ReadOwnerRequestForTest(ctx, e.repos.Enrollment(), result.RequestID)
	require.NoError(t, err)
	assert.Equal(t, capability.RequestSourceContractImport, request.SubmissionSource)
	assert.Empty(t, request.GuardianEmail, "the request names no address")
	assert.Empty(t, request.GuardianFirstName+request.GuardianLastName)
	assert.Nil(t, request.GuardianAccountID)
	assert.Empty(t, request.LegalBlocksSnapshot, "no parent declared anything")
	assert.True(t, request.ConsentFlags.IsZero())
	contractID, _ := request.SourceMetadata.Lookup("contract_id")
	assert.EqualValues(t, e.contract, contractID)
	require.NotNil(t, request.StatusTokenExpires)
	assert.False(t, request.StatusTokenExpires.After(request.SubmittedAt), "nobody is given the status token")

	child, err := ReadOwnerChildForTest(ctx, e.repos.Enrollment(), result.RequestChildID)
	require.NoError(t, err)
	assert.Equal(t, capability.ChildStatusApproved, child.Status)
	require.NotNil(t, child.CreatedStudentID)
	assert.Equal(t, student.ID, *child.CreatedStudentID)
	assert.Nil(t, child.MatchedStudentID)
	assert.False(t, child.MatchedByOffice)
	assert.Equal(t, "Lina", child.FirstName)
	assert.Equal(t, calendar.NewDate(2018, 4, 15), child.DateOfBirth)
	require.NotNil(t, child.ReviewedAt, "the contract reads the acceptance from it")
	require.NotNil(t, child.ReviewedBy)
	assert.Equal(t, e.creatorID, *child.ReviewedBy)

	stored, err := testpkg.TenantQuery2(t, ctx, e.db, e.repos.Enrollment().RequestChildOfferingsAtDate, child.ID, e.sourcePhase.ServiceStartDate)
	require.NoError(t, err)
	require.Len(t, stored, 1)
	assert.Equal(t, e.offering.ID, stored[0].CareOfferingID)
	assert.Equal(t, []string{"mon", "wed"}, stored[0].SelectedDays)
	rosters := `SELECT COUNT(*) FROM activities.student_enrollments WHERE tenant_id = ? AND student_id = ? AND activity_group_id = ?`
	assert.Equal(t, 1, e.count(t, rosters, testpkg.Tenant(t), student.ID, e.groupID), "the approval derives the roster of the offering")

	assert.Equal(t, before, e.snapshot(t), "the child record, the guardians, the consents, the plans and the outboxes stay as they are")
	assert.Len(t, e.outbox.entries, mails, "no parent mail")
	assert.Zero(t, e.bookings.announcements, "no pickup announcement reaches the guardians")
	assert.Zero(t, e.bookings.adjustments)

	// The contract of the Träger reads the child as accepted, with its
	// child record and without evidence of a parent's agreement.
	applications, err := testpkg.TenantQuery1(t, ctx, e.db,
		enrollmentCompose.NewContractApplications(securityruntime.Fingerprint).AcceptedContractApplications, []int64{child.ID})
	require.NoError(t, err)
	require.Len(t, applications, 1)
	require.NotNil(t, applications[0].StudentID)
	assert.Equal(t, student.ID, *applications[0].StudentID)
	assert.Equal(t, e.sourcePhase.ID, applications[0].PhaseID)
	assert.NotNil(t, applications[0].AcceptedAt)
	assert.Empty(t, applications[0].Acceptances)
	assert.Empty(t, applications[0].GuardianEmail)

	// A parent account with the guardian's address finds no request.
	require.NoError(t, tenant.WithAdminTx(ctx, e.db, func(txCtx context.Context, _ bun.Tx) error {
		rows, err := enrollmentCompose.NewClocked(time.Now).AccountRequests(txCtx, account.ID, account.Email)
		assert.Empty(t, rows, "the parents portal lists no request of the silent enrollment")
		return err
	}))

	// The approved child occupies its place like every approved child.
	peak, err := testpkg.TenantQuery4(t, ctx, e.db, e.repos.Enrollment().OfferingCapacityPeak, e.offering.ID, []int64(nil),
		e.sourcePhase.ServiceStartDate, capability.Date(calendar.Date(e.sourcePhase.ServiceEndDate).AddDays(1)))
	require.NoError(t, err)
	assert.Equal(t, 1, peak)

	// A repeated call answers the same enrollment and writes nothing.
	requests := `SELECT COUNT(*) FROM enrollment.requests WHERE tenant_id = ? AND submission_source = ?`
	again := e.enroll(t, input)
	assert.Equal(t, capability.ContractEnrollmentResult{ContractID: e.contract, StudentID: student.ID,
		Status: capability.ContractEnrollmentExisting, RequestID: result.RequestID, RequestChildID: result.RequestChildID}, again[0])
	assert.Equal(t, 1, e.count(t, requests, testpkg.Tenant(t), capability.RequestSourceContractImport))
	assert.Equal(t, 1, e.count(t, rosters, testpkg.Tenant(t), student.ID, e.groupID))
	// Other bookings than the stored ones are not written over the approved
	// child: its rosters are derived once.
	differs := e.enroll(t, e.input(student.ID, e.booking("mon", "tue", "wed")))
	assert.Equal(t, capability.ContractEnrollmentRefused, differs[0].Status)
	assert.Equal(t, capability.ContractEnrollmentBookingsDiffer, differs[0].Reason)
	assert.Equal(t, result.RequestChildID, differs[0].RequestChildID)

	// Each further child of a call costs the same statements: the phase, its
	// offerings and the applications of all children are read once.
	pair := testpkg.CaptureQueriesForContext(t, e.db)
	two, err := testpkg.TenantQuery1(t, pair.Context(ctx), e.db, e.owner.EnrollContractChildren, []capability.ContractEnrollment{
		e.input(e.student(t, "Mia").ID, e.booking("mon")), e.input(e.student(t, "Ben").ID, e.booking("tue"))})
	require.NoError(t, err)
	require.Equal(t, capability.ContractEnrollmentEnrolled, two[1].Status)
	perChild := len(pair.Queries()) - len(counter.Queries())
	t.Logf("contract enrollment: %d statements for two children, %d per further child", len(pair.Queries()), perChild)
	assert.Less(t, perChild, len(counter.Queries()), "a further child repeats no read of the phase")

	// The office changes the bookings of this child as of any other.
	update, err := testpkg.TenantQuery1(t, ctx, e.db, e.owner.UpdateChildOfferings, enrollmentAPI.UpdateChildOfferingsInput{
		RequestID: result.RequestID, ChildID: result.RequestChildID, ActorAccountID: e.creatorID, ActorRole: "admin",
		Reason: "Zusätzlicher Tag", Offerings: []enrollmentAPI.OfferingAdjustmentSelection{
			{OfferingID: e.offering.ID, SelectedDays: []string{"mon", "tue", "wed"}}},
	})
	require.NoError(t, err)
	require.NotNil(t, update.Child)
	stored, err = testpkg.TenantQuery2(t, ctx, e.db, e.repos.Enrollment().RequestChildOfferingsAtDate, child.ID, e.sourcePhase.ServiceStartDate)
	require.NoError(t, err)
	require.Len(t, stored, 1)
	assert.Equal(t, []string{"mon", "tue", "wed"}, stored[0].SelectedDays)
	assert.Equal(t, 1, e.bookings.adjustments, "the usual way is the offering adjustment")
}

// A child with another application in the phase gets no second enrollment,
// and every row that cannot be enrolled says why and writes nothing. A check
// answers the same without a write.
func TestContractEnrollmentRefusesWhatItCannotEnroll(t *testing.T) {
	t.Parallel()
	e := setupContractEnrollment(t)
	ctx := testpkg.Ctx(t)
	requestID, childID, enrolled := submitApprovedAdjustmentChild(t, e.decisionTestEnv, "contract-enrollment-has@example.com", "Angemeldet",
		[]*offeringContract.CareOfferingRecord{e.offering})

	inactive, withoutPlace, undated, planned := e.student(t, "Ina"), e.student(t, "Ole"), testpkg.CreateTestStudent(t, e.db, "Uwe", "Vertrag", "1a"), e.student(t, "Pia")
	_, err := e.db.ExecContext(ctx, `UPDATE users.student_school_memberships SET status = 'inactive'
		WHERE tenant_id = ? AND student_profile_id = ?`, testpkg.Tenant(t), inactive.ID)
	require.NoError(t, err)
	testpkg.MarkTestStudentWithoutCarePlace(t, e.db, withoutPlace.ID)
	valid := e.student(t, "Val")

	otherPhase := &capability.Phase{Name: "contract-enrollment-other-" + t.Name(), Kind: capability.PhaseKindSchoolYear,
		ServiceStartDate: capability.Date(calendar.NewDate(2027, 9, 1)), ServiceEndDate: capability.Date(calendar.NewDate(2028, 7, 31)), IsActive: true}
	otherPhase.TenantID = testpkg.Tenant(t)
	require.NoError(t, InsertOwnerPhaseForTest(ctx, e.repos.Enrollment(), otherPhase))
	foreign := e.input(valid.ID, e.booking("mon"))
	foreign.PhaseID = otherPhase.ID
	foreign.Bookings[0].ValidFrom, foreign.Bookings[0].ValidUntil = calendar.NewDate(2027, 9, 1), calendar.NewDate(2028, 8, 1)
	unknownPhase := e.input(valid.ID, e.booking("mon"))
	unknownPhase.PhaseID = testpkg.UniqueTestTenantID(t)
	late := e.booking("mon")
	late.ValidFrom = late.ValidFrom.AddDays(30)
	long := e.booking("mon")
	long.ValidUntil = long.ValidUntil.AddDays(1)
	change := e.input(planned.ID, e.booking("mon"))
	change.Changes = []capability.ContractBookingChange{{EffectiveFrom: calendar.NewDate(2027, 2, 1), Bookings: []capability.ContractBooking{e.booking("tue")}}}

	inputs := []capability.ContractEnrollment{
		e.input(enrolled, e.booking("mon")), e.input(testpkg.UniqueTestTenantID(t), e.booking("mon")),
		e.input(inactive.ID, e.booking("mon")), e.input(withoutPlace.ID, e.booking("mon")), e.input(undated.ID, e.booking("mon")),
		foreign, unknownPhase, e.input(valid.ID, e.booking("sat")), e.input(valid.ID, e.booking()), e.input(valid.ID),
		e.input(valid.ID, late), e.input(valid.ID, long), e.input(valid.ID, e.booking("mon"), e.booking("tue")), change,
	}
	want := []capability.ContractEnrollmentResult{
		{Status: capability.ContractEnrollmentHasApplication, RequestID: requestID, RequestChildID: childID},
		{Status: capability.ContractEnrollmentRefused, Reason: capability.ContractEnrollmentStudentMissing},
		{Status: capability.ContractEnrollmentRefused, Reason: capability.ContractEnrollmentStudentInactive},
		{Status: capability.ContractEnrollmentRefused, Reason: capability.ContractEnrollmentWithoutCarePlace},
		{Status: capability.ContractEnrollmentRefused, Reason: capability.ContractEnrollmentBirthDateMissing},
		{Status: capability.ContractEnrollmentRefused, Reason: capability.ContractEnrollmentOfferingPhase},
		{Status: capability.ContractEnrollmentRefused, Reason: capability.ContractEnrollmentPhaseMissing},
		{Status: capability.ContractEnrollmentRefused, Reason: capability.ContractEnrollmentDayUnavailable},
		{Status: capability.ContractEnrollmentRefused, Reason: capability.ContractEnrollmentDayUnavailable},
		{Status: capability.ContractEnrollmentRefused, Reason: capability.ContractEnrollmentOfferingPhase},
		{Status: capability.ContractEnrollmentRefused, Reason: capability.ContractEnrollmentBookingWindow},
		{Status: capability.ContractEnrollmentRefused, Reason: capability.ContractEnrollmentBookingWindow},
		{Status: capability.ContractEnrollmentRefused, Reason: capability.ContractEnrollmentBookingWindow},
		{Status: capability.ContractEnrollmentRefused, Reason: capability.ContractEnrollmentPlannedChange},
	}
	for i := range want {
		want[i].ContractID, want[i].StudentID = e.contract, inputs[i].StudentID
	}
	assert.Equal(t, want, e.check(t, inputs...), "a check names every reason")
	before := e.snapshot(t)
	assert.Equal(t, want, e.enroll(t, inputs...))
	assert.Zero(t, e.count(t, `SELECT COUNT(*) FROM enrollment.requests WHERE tenant_id = ? AND submission_source = ?`,
		testpkg.Tenant(t), capability.RequestSourceContractImport), "a refused row writes nothing")
	assert.Equal(t, before, e.snapshot(t))
	assert.Zero(t, e.bookings.adjustments, "a planned change is held back, never written as an adjustment")

	// Two rows of one child in one call enroll it once.
	twice := e.enroll(t, e.input(valid.ID, e.booking("mon")), e.input(valid.ID, e.booking("mon")))
	assert.Equal(t, capability.ContractEnrollmentEnrolled, twice[0].Status)
	assert.Equal(t, capability.ContractEnrollmentExisting, twice[1].Status)
	assert.Equal(t, twice[0].RequestChildID, twice[1].RequestChildID)
}
