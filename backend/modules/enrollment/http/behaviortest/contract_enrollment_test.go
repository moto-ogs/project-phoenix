package enrollmenthttp_test

import (
	"context"
	"fmt"
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
	querybudgets "github.com/moto-ogs/project-phoenix/test/query-budgets"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

// The enrollment of the children of imported care contracts (#7760, ADR
// 0309) against the real database: what it writes, what it leaves alone and
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

// contractRunDay is the day the enrollment runs on in these suites: a
// Monday within the service of the phase.
var contractRunDay = calendar.NewDate(2027, 1, 4)

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
	// The run happens within the service of the phase: no child is enrolled
	// from a day that is still to come.
	env.today = contractRunDay
	// The pickup auto excusals resync from the day of the harness, so the
	// coming pickup exception of a case is one on every day the suite runs.
	env.excusalToday = func() calendar.Date { return decisionTestToday }
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

// booking is a booking of the offering over the service of the phase, with
// what a plan read of the offering: its end times, weekdays and mode.
func (e *contractEnrollmentEnv) booking(days ...string) capability.ContractBooking {
	ends := map[string]string{}
	for _, day := range days {
		ends[day] = e.offering.PickupTimes[day]
	}
	return capability.ContractBooking{CareOfferingID: e.offering.ID, Days: days,
		ValidFrom: calendar.Date(e.sourcePhase.ServiceStartDate), ValidUntil: calendar.Date(e.sourcePhase.ServiceEndDate).AddDays(1),
		EndTimes: ends, AvailableDays: e.offering.AvailableDays, DaysOfWeekMode: e.offering.DaysOfWeekMode}
}

func (e *contractEnrollmentEnv) input(studentID int64, bookings ...capability.ContractBooking) capability.ContractEnrollment {
	return capability.ContractEnrollment{StudentID: studentID, PhaseID: e.sourcePhase.ID, ContractID: e.contract,
		ServiceStart: calendar.Date(e.sourcePhase.ServiceStartDate), ServiceEnd: calendar.Date(e.sourcePhase.ServiceEndDate),
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
// and accesses, consents, the weekly plans, and everything that sends. The
// pickup exceptions of a day are not among them: they keep what staff or
// parents entered, but the excusal derived from the booked end time follows
// the bookings (asserted where a child has one).
var silentTables = []string{
	"users.student_profiles", "users.student_school_memberships", "users.student_care_profiles", "users.persons",
	"users.guardian_profiles", "users.guardian_phone_numbers", "users.student_guardian_relationships",
	"auth.guardian_student_access", "auth.account_tenants", "users.privacy_consents", "audit.student_consent_changes",
	"audit.student_field_edits", "users.student_care_exits", "schedule.student_pickup_schedules",
	"schedule.student_arrival_schedules", "platform.email_outbox", "platform.push_outbox",
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
	// The child has a weekly pickup plan and a pickup exception on a coming
	// Monday, earlier than the end time the booking brings.
	staff := testpkg.CreateTestStaff(t, e.db, "Contract", "Pickup")
	testpkg.CreateTestPickupSchedule(t, e.db, student.ID, 3, staff.ID, "15:00")
	monday := nextWeekday(calendar.Date(e.sourcePhase.ServiceStartDate), time.Monday)
	exception := testpkg.CreateTestPickupException(t, e.db, student.ID, monday, staff.ID, "13:00", "Arzttermin")
	before := e.snapshot(t)
	mails := len(e.outbox.entries)

	input := e.input(student.ID, e.booking("mon", "wed"))
	assert.Equal(t, capability.ContractEnrollmentEnrolled, e.check(t, input)[0].Status)
	assert.Zero(t, e.count(t, `SELECT COUNT(*) FROM enrollment.requests WHERE tenant_id = ? AND submission_source = ?`,
		testpkg.Tenant(t), capability.RequestSourceContractImport), "a check writes nothing")

	results := e.enroll(t, input)
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
	// The pickup exception keeps its day, its time and its reason. What
	// follows from the bookings is derived again, as after every approval:
	// the booked end time is the child's end of the day now, so the earlier
	// pickup of the exception excuses the child from its time on.
	var kept struct {
		Day         calendar.Date `bun:"exception_date"`
		Pickup      string        `bun:"pickup"`
		Reason      string        `bun:"reason"`
		ExcusedAuto bool          `bun:"excused_auto"`
		ExcusedFrom string        `bun:"excused_from"`
	}
	require.NoError(t, e.db.NewRaw(`SELECT exception_date, to_char(pickup_time, 'HH24:MI') AS pickup, reason, excused_auto,
		COALESCE(to_char(excused_from, 'HH24:MI'), '') AS excused_from
		FROM schedule.student_pickup_exceptions WHERE tenant_id = ? AND id = ?`, testpkg.Tenant(t), exception.ID).Scan(ctx, &kept))
	assert.Equal(t, monday, kept.Day)
	assert.Equal(t, "13:00", kept.Pickup)
	assert.Equal(t, "Arzttermin", kept.Reason)
	assert.True(t, kept.ExcusedAuto, "the excusal that follows from the booked end time is derived")
	assert.Equal(t, "13:00", kept.ExcusedFrom)
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

	// The office changes the bookings of this child as of any other.
	update, err := testpkg.TenantQuery1(t, ctx, e.db, correctOverRead(e.owner), enrollmentAPI.UpdateChildOfferingsInput{
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
	foreign.PhaseID, foreign.ServiceStart, foreign.ServiceEnd = otherPhase.ID, calendar.NewDate(2027, 9, 1), calendar.NewDate(2028, 7, 31)
	foreign.Bookings[0].ValidFrom, foreign.Bookings[0].ValidUntil = calendar.NewDate(2027, 9, 1), calendar.NewDate(2028, 8, 1)
	unknownPhase := e.input(valid.ID, e.booking("mon"))
	unknownPhase.PhaseID = testpkg.UniqueTestTenantID(t)
	early := e.booking("mon")
	early.ValidFrom = early.ValidFrom.AddDays(-1)
	long := e.booking("mon")
	long.ValidUntil = long.ValidUntil.AddDays(1)
	change := e.input(planned.ID, e.booking("mon"))
	change.Changes = []capability.ContractBookingChange{{EffectiveFrom: calendar.NewDate(2027, 2, 1), Bookings: []capability.ContractBooking{e.booking("tue")}}}

	inputs := []capability.ContractEnrollment{
		e.input(enrolled, e.booking("mon")), e.input(testpkg.UniqueTestTenantID(t), e.booking("mon")),
		e.input(inactive.ID, e.booking("mon")), e.input(withoutPlace.ID, e.booking("mon")), e.input(undated.ID, e.booking("mon")),
		foreign, unknownPhase, e.input(valid.ID, e.booking("sat")), e.input(valid.ID, e.booking()), e.input(valid.ID),
		e.input(valid.ID, early), e.input(valid.ID, long), e.input(valid.ID, e.booking("mon"), e.booking("tue")), change,
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

	// Two rows of one child in one call enroll it once; a third row with
	// other bookings is refused like a repeated call with other bookings.
	twice := e.enroll(t, e.input(valid.ID, e.booking("mon")), e.input(valid.ID, e.booking("mon")), e.input(valid.ID, e.booking("tue")))
	assert.Equal(t, capability.ContractEnrollmentEnrolled, twice[0].Status)
	assert.Equal(t, capability.ContractEnrollmentExisting, twice[1].Status)
	assert.Equal(t, twice[0].RequestChildID, twice[1].RequestChildID)
	assert.NotZero(t, twice[0].RequestChildID)
	assert.Equal(t, capability.ContractEnrollmentBookingsDiffer, twice[2].Reason)
	assert.Equal(t, 1, e.count(t, `SELECT COUNT(*) FROM enrollment.requests WHERE tenant_id = ? AND submission_source = ?`,
		testpkg.Tenant(t), capability.RequestSourceContractImport))
}

// What the plan read of the school is compared again under the locks of the
// enrollment. An offering whose end time, weekdays or weekday mode changed
// since, or a phase whose service moved, answers the child as changed and
// writes nothing: the bookings were proved against a school that is no
// longer there.
func TestContractEnrollmentRefusesAPlanTheSchoolOutgrew(t *testing.T) {
	t.Parallel()
	e := setupContractEnrollment(t)
	ctx := testpkg.Ctx(t)
	student := e.student(t, "Lina")
	planned := e.input(student.ID, e.booking("mon", "wed"))
	require.NotEmpty(t, planned.Bookings[0].EndTimes["mon"], "the offering has an end time on Monday")

	// Between the plan and the enrollment the school moves the end time of
	// the offering on Monday.
	_, err := e.db.ExecContext(ctx, `UPDATE enrollment.care_offerings SET pickup_times = jsonb_set(pickup_times, '{mon}', '"17:45"')
		WHERE tenant_id = ? AND id = ?`, testpkg.Tenant(t), e.offering.ID)
	require.NoError(t, err)
	before := e.snapshot(t)
	want := []capability.ContractEnrollmentResult{{ContractID: e.contract, StudentID: student.ID, Status: capability.ContractEnrollmentChanged}}
	assert.Equal(t, want, e.check(t, planned))
	assert.Equal(t, want, e.enroll(t, planned))
	rows := `SELECT (SELECT COUNT(*) FROM enrollment.requests WHERE tenant_id = ? AND submission_source = 'contract_import')
		+ (SELECT COUNT(*) FROM activities.student_enrollments WHERE tenant_id = ? AND student_id = ?)`
	assert.Zero(t, e.count(t, rows, testpkg.Tenant(t), testpkg.Tenant(t), student.ID), "no request, no child, no roster")
	assert.Equal(t, before, e.snapshot(t))

	// A weekday of the offering the booking does not use changes nothing for
	// the child; a plan made on the new end time is enrolled.
	fresh := e.input(student.ID, e.booking("wed"))
	assert.Equal(t, capability.ContractEnrollmentEnrolled, e.check(t, fresh)[0].Status)
	current := planned
	current.Bookings = []capability.ContractBooking{e.booking("mon", "wed")}
	current.Bookings[0].EndTimes["mon"] = "17:45"
	assert.Equal(t, capability.ContractEnrollmentEnrolled, e.check(t, current)[0].Status)

	// Other weekdays on offer, another weekday mode and a moved service of
	// the phase are the same answer.
	days := e.input(student.ID, e.booking("wed"))
	days.Bookings[0].AvailableDays = []string{"mon", "tue", "wed"}
	mode := e.input(student.ID, e.booking("wed"))
	mode.Bookings[0].DaysOfWeekMode = offeringContract.DaysOfWeekModeFixed
	moved := e.input(student.ID, e.booking("wed"))
	moved.ServiceEnd = moved.ServiceEnd.AddDays(-1)
	unplanned := e.input(student.ID, e.booking("wed"))
	unplanned.ServiceStart, unplanned.ServiceEnd = "", ""
	for name, input := range map[string]capability.ContractEnrollment{"weekdays": days, "mode": mode, "phase": moved, "no phase": unplanned} {
		assert.Equal(t, capability.ContractEnrollmentChanged, e.enroll(t, input)[0].Status, name)
	}
	assert.Zero(t, e.count(t, rows, testpkg.Tenant(t), testpkg.Tenant(t), student.ID))

	// An enrollment of this source that exists is answered as changed too,
	// not as existing, when its offering changed since the plan.
	stored := e.enroll(t, current)
	require.Equal(t, capability.ContractEnrollmentEnrolled, stored[0].Status)
	assert.Equal(t, capability.ContractEnrollmentExisting, e.enroll(t, current)[0].Status)
	again := e.enroll(t, planned)
	assert.Equal(t, capability.ContractEnrollmentChanged, again[0].Status)
	assert.Equal(t, stored[0].RequestChildID, again[0].RequestChildID)
}

// The statements of an enrollment run, composed as production composes it,
// with the resync of the pickup auto excusals. What Enrollment owns is read
// and written in sets: the gates, the phase with its offerings and
// applications, the child records with their persons, the requests, the
// children, the choices and the approvals cost the same for one child and
// for three. Care Plan writes the care of each child one child at a time:
// its bookings, its rosters and its multi-source rosters with the building
// blocks of an approval, and the resync of the child's pickup auto
// excusals, which locks the child record and reads its coming pickup
// exceptions. Every child here has one such exception that gains an
// excusal. That residual is asserted exactly, so a further statement per
// child fails here.
func TestContractEnrollmentQueryBudget(t *testing.T) {
	t.Parallel()
	e := setupContractEnrollment(t)
	ctx := testpkg.Ctx(t)
	// perChildCarePlan is Care Plan's share of one child with one offering
	// that feeds one roster: 3 statements to record the bookings, 9 to
	// derive the rosters, 3 to reconcile the multi-source rosters.
	// perChildExcusal is the resync of the pickup auto excusals of one
	// child: 2 statements to lock the child record and read its coming
	// pickup exceptions, and 14 for the one exception here that gains an
	// excusal (the day lock, the baseline from the bookings, the staff task
	// of the day, the exception and the blocks it excuses). A child without
	// a coming pickup exception costs the 2.
	const perChildCarePlan, perChildExcusal = 15, 16
	staff := testpkg.CreateTestStaff(t, e.db, "Contract", "Budget")
	monday := nextWeekday(calendar.Date(e.sourcePhase.ServiceStartDate), time.Monday)
	run := func(names ...string) testpkg.QueryMeasurement {
		inputs := make([]capability.ContractEnrollment, len(names))
		for i, name := range names {
			student := e.student(t, name)
			testpkg.CreateTestPickupException(t, e.db, student.ID, monday, staff.ID, "13:00", "Arzttermin")
			inputs[i] = e.input(student.ID, e.booking("mon", "wed"))
		}
		counter := testpkg.CaptureQueriesForContext(t, e.db)
		results, err := testpkg.TenantQuery1(t, counter.Context(ctx), e.db, e.owner.EnrollContractChildren, inputs)
		require.NoError(t, err)
		for _, result := range results {
			require.Equal(t, capability.ContractEnrollmentEnrolled, result.Status)
		}
		return counter.Measurement(counter.Queries())
	}
	one := run("Ada")
	three := run("Bea", "Cem", "Dua")
	t.Logf("contract enrollment: %d statements for one child, %d for three", len(one.Statements), len(three.Statements))
	assert.Equal(t, 2*(perChildCarePlan+perChildExcusal), len(three.Statements)-len(one.Statements),
		"two further children cost only Care Plan's per-child statements")
	assert.Equal(t, 46, len(one.Statements), "15 of Enrollment and the transaction, 31 of Care Plan for the child")
	assert.Equal(t, 4, e.count(t, `SELECT COUNT(*) FROM schedule.student_pickup_exceptions WHERE tenant_id = ? AND excused_auto`, testpkg.Tenant(t)),
		"the resync ran for every child")
	querybudgets.AssertQueryBudget(t, "services.enrollment.contract_enrollments.enroll", one)

	// The count has a term per phase, not per child: each phase of a call is
	// locked, and its offerings and the applications that hold its children
	// are read once. Two rows the run answers without a write, in one phase
	// and in two.
	second := *e.sourcePhase
	second.ID, second.Name = 0, "Zweite Phase "+t.Name()
	require.NoError(t, InsertOwnerPhaseForTest(ctx, e.repos.Enrollment(), &second))
	const perPhaseCheck, perPhaseRun = 2, 3
	answered := func(call func(context.Context, []capability.ContractEnrollment) ([]capability.ContractEnrollmentResult, error), phases ...int64) int {
		inputs := make([]capability.ContractEnrollment, len(phases))
		for i, phase := range phases {
			inputs[i] = e.input(e.student(t, fmt.Sprintf("Phase%d", i)).ID, e.booking("mon"))
			// A row that names no service of its phase is answered as changed.
			inputs[i].PhaseID, inputs[i].ServiceStart, inputs[i].ServiceEnd = phase, "", ""
		}
		counter := testpkg.CaptureQueriesForContext(t, e.db)
		results, err := testpkg.TenantQuery1(t, counter.Context(ctx), e.db, call, inputs)
		require.NoError(t, err)
		for _, result := range results {
			require.Equal(t, capability.ContractEnrollmentChanged, result.Status)
		}
		return len(counter.Queries())
	}
	first := e.sourcePhase.ID
	assert.Equal(t, perPhaseCheck, answered(e.owner.CheckContractChildren, first, second.ID)-answered(e.owner.CheckContractChildren, first, first),
		"a further phase costs the check its offerings and its holders")
	assert.Equal(t, perPhaseRun, answered(e.owner.EnrollContractChildren, first, second.ID)-answered(e.owner.EnrollContractChildren, first, first),
		"a further phase costs the run its lock, its offerings and its holders")
}

// The rollover of a school year carries the child of a contract enrollment
// into the school's review, in both modes (ADR 0309): its request names no
// guardian, so no parent gets the renewal mail or opens the status page.
// Waiting for the parents would withdraw the child at the deadline (opt-in)
// or renew it unseen (opt-out). The renewal keeps the source, sends nothing
// and is left alone by the deadline.
func TestRolloverSendsAContractEnrollmentToReviewOptIn(t *testing.T) {
	t.Parallel()
	rolloverOfAContractEnrollment(t, capability.PhaseRolloverModeOptIn)
}

func TestRolloverSendsAContractEnrollmentToReviewOptOut(t *testing.T) {
	t.Parallel()
	rolloverOfAContractEnrollment(t, capability.PhaseRolloverModeOptOut)
}

func rolloverOfAContractEnrollment(t *testing.T, mode string) {
	t.Helper()
	e := setupContractEnrollment(t)
	ctx := testpkg.Ctx(t)
	enrolled := e.enroll(t, e.input(e.student(t, "Lina").ID, e.booking("mon", "wed")))
	require.Equal(t, capability.ContractEnrollmentEnrolled, enrolled[0].Status)
	mails := len(e.outbox.entries)

	preview, err := e.rolloverSvc.PreviewPhaseFromSource(ctx, e.sourcePhase.ID, true)
	require.NoError(t, err)
	assert.Equal(t, 1, preview.ReviewByReason[capability.ReviewReasonNoGuardian], "the preview names what the rollover does")
	assert.Zero(t, preview.CarriedCount)

	request := validRolloverRequest(e.rolloverTestEnv, mode, true)
	result, err := e.rolloverSvc.CreatePhaseFromSource(ctx, request)
	require.NoError(t, err)
	assert.Equal(t, map[string]int{capability.ReviewReasonNoGuardian: 1}, result.ReviewByReason)
	assert.Equal(t, 1, result.ReviewCount)
	assert.Zero(t, result.RolledCount, "the child waits for no parent")
	assert.Zero(t, result.EnqueuedEmails)

	renewal := func() (status, reason, source, email string) {
		require.NoError(t, e.db.NewRaw(`SELECT rc.status, COALESCE(rc.review_reason, ''), req.submission_source, req.guardian_email
			FROM enrollment.request_children AS rc JOIN enrollment.requests AS req ON req.id = rc.request_id AND req.tenant_id = rc.tenant_id
			WHERE rc.tenant_id = ? AND rc.rollover_source_child_id = ?`, testpkg.Tenant(t), enrolled[0].RequestChildID).
			Scan(ctx, &status, &reason, &source, &email))
		return status, reason, source, email
	}
	status, reason, source, email := renewal()
	assert.Equal(t, capability.ChildStatusPendingAdminReview, status)
	assert.Equal(t, capability.ReviewReasonNoGuardian, reason)
	assert.Equal(t, capability.RequestSourceContractImport, source, "the renewal carries the source")
	assert.Empty(t, email)

	// The deadline passes: the child is neither withdrawn nor renewed.
	summary, err := e.rolloverSvc.RunDeadlineWorker(ctx, request.RolloverDeadline.AddDate(0, 0, 2))
	require.NoError(t, err)
	assert.Zero(t, summary.PendingRenewalToWithdrawn+summary.AutoRenewedToSubmitted+summary.AutoRenewedToApproved)
	status, reason, _, _ = renewal()
	assert.Equal(t, capability.ChildStatusPendingAdminReview, status, "the deadline leaves the review alone")
	assert.Equal(t, capability.ReviewReasonNoGuardian, reason)
	assert.Len(t, e.outbox.entries, mails, "no renewal mail")
}
