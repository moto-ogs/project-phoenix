package enrollmenthttp_test

import (
	"testing"

	capability "github.com/moto-ogs/project-phoenix/modules/enrollment"
	enrollmentAPI "github.com/moto-ogs/project-phoenix/modules/enrollment/http"
	offeringContract "github.com/moto-ogs/project-phoenix/modules/enrollment/offeringcontract"
	"github.com/moto-ogs/project-phoenix/modules/timetable"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// The rules of the enrollment of the children of imported care contracts
// that the second review round added (#7760, ADR 0309): no booking before
// the contract, the confirmation of a proved application, an offering that
// stopped counting as care and a school without derived care.

// bookingOf is a booking of an offering of the phase with what a plan read
// of it.
func bookingOf(offering *offeringContract.CareOfferingRecord, from, until calendar.Date, days ...string) capability.ContractBooking {
	ends := map[string]string{}
	for _, day := range days {
		ends[day] = offering.PickupTimes[day]
	}
	return capability.ContractBooking{CareOfferingID: offering.ID, Days: days, ValidFrom: from, ValidUntil: until,
		EndTimes: ends, AvailableDays: offering.AvailableDays, DaysOfWeekMode: offering.DaysOfWeekMode}
}

// linkedRoster is a timetable template with one weekly schedule in a period
// around the phase, and a room for its occurrences.
func linkedRoster(t *testing.T, e *contractEnrollmentEnv, name string, weekday int) (*careTemplateGroup, *calendarPeriod) {
	t.Helper()
	template := createCareOfferingTemplateGroup(t, e.db, name)
	period := createCareOfferingTestPeriod(t, e.db, name, calendar.NewDate(2026, 8, 1), calendar.NewDate(2027, 8, 31))
	createCareOfferingTemplateSchedule(t, e.db, template.ID, weekday, &period.ID)
	return template, period
}

const contractOccurrenceRows = `SELECT COUNT(*) FROM schedule.instance_students AS s JOIN schedule.activity_instances AS i
	ON i.id = s.instance_id AND i.tenant_id = s.tenant_id
	WHERE s.tenant_id = ? AND s.student_id = ? AND i.activity_group_id = ? AND i.date = ?`

// No child is booked before its contract. The service of the phase starts
// on 1 September, the contract on 4 January: the booking and the roster
// rows start on 4 January, on the roster the offering names through its
// direct link and on the one that names the offering as its source, and the
// child is on no occurrence before that day. Read at the service start of
// the phase, such a child had no booking and got no roster at all.
func TestContractEnrollmentStartsWithTheContract(t *testing.T) {
	t.Parallel()
	e := setupContractEnrollment(t)
	ctx := testpkg.Ctx(t)
	linked, linkedPeriod := linkedRoster(t, e, "contract-mid-linked", timetable.WeekdayTuesday)
	createCareOfferingTemplateSchedule(t, e.db, linked.ID, weekdayMonday, &linkedPeriod.ID)
	offering := createAdjustmentCareOfferingWith(t, e.decisionTestEnv, "Ganztag ab Januar "+t.Name(), func(o *offeringContract.CareOfferingRecord) {
		o.ActivityGroupID, o.CountsAsCare, o.PickupTimes = &linked.ID, true, carePickupTimes("mon", "tue", "wed", "thu", "fri")
	})
	sourcedPeriod := offeringSourcePeriod(t, e.decisionTestEnv)
	sourced := createSourcedTemplate(t, e.decisionTestEnv, "contract-mid-sourced", offering.ID, nil, sourcedPeriod)

	careStart := calendar.NewDate(2027, 1, 4)
	occurrences := map[*careTemplateGroup][2]calendar.Date{
		linked:  {calendar.NewDate(2026, 12, 15), calendar.NewDate(2027, 1, 5)},
		sourced: {calendar.NewDate(2026, 12, 14), calendar.NewDate(2027, 1, 4)},
	}
	periods := map[*careTemplateGroup]*calendarPeriod{linked: linkedPeriod, sourced: sourcedPeriod}
	for template, days := range occurrences {
		for _, day := range days {
			testpkg.CreateTestActivityInstance(t, e.db, day, *template.PlannedRoomID,
				testpkg.ActivityInstanceOpts{ActivityGroupID: &template.ID, CalendarPeriodID: &periods[template].ID})
		}
	}
	student := e.student(t, "Lina")
	input := e.input(student.ID, bookingOf(offering, careStart, calendar.Date(e.sourcePhase.ServiceEndDate).AddDays(1), "mon", "tue"))
	result := e.enroll(t, input)
	require.Equal(t, capability.ContractEnrollmentEnrolled, result[0].Status)

	var booked calendar.Date
	require.NoError(t, e.db.NewRaw(`SELECT valid_from FROM enrollment.care_offering_bookings WHERE tenant_id = ? AND request_child_id = ?`,
		testpkg.Tenant(t), result[0].RequestChildID).Scan(ctx, &booked))
	assert.Equal(t, careStart, booked, "the booking starts with the contract")
	for name, template := range map[string]*careTemplateGroup{"direct link": linked, "source rule": sourced} {
		var from calendar.Date
		require.NoError(t, e.db.NewRaw(`SELECT valid_from FROM activities.student_enrollments WHERE tenant_id = ? AND student_id = ?
			AND activity_group_id = ?`, testpkg.Tenant(t), student.ID, template.ID).Scan(ctx, &from), name)
		assert.Equal(t, careStart, from, "%s: the roster row starts with the contract", name)
		assert.Zero(t, e.count(t, contractOccurrenceRows, testpkg.Tenant(t), student.ID, template.ID, occurrences[template][0]),
			"%s: on no occurrence before the contract", name)
		assert.Equal(t, 1, e.count(t, contractOccurrenceRows, testpkg.Tenant(t), student.ID, template.ID, occurrences[template][1]),
			"%s: on the occurrence from the contract's first day on", name)
	}
	assert.Zero(t, e.count(t, `SELECT COUNT(*) FROM activities.student_enrollments WHERE tenant_id = ? AND student_id = ? AND valid_from < ?`,
		testpkg.Tenant(t), student.ID, careStart), "no roster row reaches back before the contract")

	// A repeated call finds the enrollment by its stored bookings, which no
	// read at the service start of the phase would show.
	again := e.enroll(t, input)
	assert.Equal(t, capability.ContractEnrollmentExisting, again[0].Status)
	assert.Equal(t, result[0].RequestChildID, again[0].RequestChildID)

	// The bookings of a child start on one day, and not before the service.
	second := createAdjustmentCareOfferingWith(t, e.decisionTestEnv, "Früh "+t.Name(), func(o *offeringContract.CareOfferingRecord) {
		o.CountsAsCare, o.PickupTimes = true, carePickupTimes("mon", "tue", "wed", "thu", "fri")
	})
	until := calendar.Date(e.sourcePhase.ServiceEndDate).AddDays(1)
	other := e.student(t, "Mats")
	apart := e.check(t, e.input(other.ID, bookingOf(offering, careStart, until, "mon"), bookingOf(second, careStart.AddDays(7), until, "mon")))
	assert.Equal(t, capability.ContractEnrollmentBookingWindow, apart[0].Reason)
}

// A contract is bound only to an application the enrollment confirmed under
// its gates. A row that names the approved application the plan proved is
// answered as existing while that application's stored bookings are the
// ones the plan read. Once the office changed its weekdays after the plan,
// the answer is changed, and nothing is bound. No such row writes anything.
func TestContractEnrollmentConfirmsAProvenApplicationOnlyUnchanged(t *testing.T) {
	t.Parallel()
	e := setupContractEnrollment(t)
	ctx := testpkg.Ctx(t)
	requestID, childID, studentID := submitApprovedAdjustmentChild(t, e.decisionTestEnv, "contract-proven@example.com", "Bewiesen",
		[]*offeringContract.CareOfferingRecord{e.offering})
	proven := func(days ...string) capability.ContractEnrollment {
		input := e.input(studentID, e.booking(days...))
		input.RequestChildID, input.ProvedOn = childID, decisionTestToday
		return input
	}
	requests := `SELECT COUNT(*) FROM enrollment.requests WHERE tenant_id = ?`
	before, written := e.snapshot(t), e.count(t, requests, testpkg.Tenant(t))
	want := []capability.ContractEnrollmentResult{{ContractID: e.contract, StudentID: studentID,
		Status: capability.ContractEnrollmentExisting, RequestID: requestID, RequestChildID: childID}}
	assert.Equal(t, want, e.check(t, proven("mon")))
	assert.Equal(t, want, e.enroll(t, proven("mon")), "the application is the child's, approved, and booked as the plan proved")
	assert.Equal(t, written, e.count(t, requests, testpkg.Tenant(t)), "a confirmation enrolls nobody")
	assert.Equal(t, before, e.snapshot(t))

	// What the plan did not prove is not confirmed: other weekdays, a plan
	// without its day, another child record, an application the school does
	// not have, an offering that changed since.
	otherStudent := proven("mon")
	otherStudent.StudentID = e.student(t, "Fremd").ID
	unknown := proven("mon")
	unknown.RequestChildID = testpkg.UniqueTestTenantID(t)
	undated := proven("mon")
	undated.ProvedOn = ""
	stale := proven("mon")
	stale.Bookings[0].EndTimes["mon"] = "17:45"
	for name, input := range map[string]capability.ContractEnrollment{"weekdays": proven("mon", "tue"), "child record": otherStudent,
		"no day": undated, "offering": stale} {
		assert.Equal(t, capability.ContractEnrollmentChanged, e.enroll(t, input)[0].Status, name)
	}
	other := e.enroll(t, unknown)
	assert.Equal(t, capability.ContractEnrollmentHasApplication, other[0].Status, "the child record has another application than the one named")
	assert.Equal(t, childID, other[0].RequestChildID)

	// Between the plan and the enrollment the office adds a weekday to the
	// approved application.
	_, err := testpkg.TenantQuery1(t, ctx, e.db, e.owner.UpdateChildOfferings, enrollmentAPI.UpdateChildOfferingsInput{
		RequestID: requestID, ChildID: childID, ActorAccountID: e.creatorID, ActorRole: "admin",
		Reason: "Zusätzlicher Tag", Offerings: []enrollmentAPI.OfferingAdjustmentSelection{
			{OfferingID: e.offering.ID, SelectedDays: []string{"mon", "tue"}}},
	})
	require.NoError(t, err)
	changed := e.enroll(t, proven("mon"))
	assert.Equal(t, capability.ContractEnrollmentChanged, changed[0].Status, "the weekdays changed after the plan")
	assert.Equal(t, childID, changed[0].RequestChildID)
	assert.Equal(t, capability.ContractEnrollmentExisting, e.enroll(t, proven("mon", "tue"))[0].Status, "a new plan proves the new bookings")
	assert.Equal(t, written, e.count(t, requests, testpkg.Tenant(t)))

	// The enrollment a run made and did not bind is confirmed the same way.
	own := e.student(t, "Lina")
	made := e.enroll(t, e.input(own.ID, e.booking("wed")))
	require.Equal(t, capability.ContractEnrollmentEnrolled, made[0].Status)
	rerun := e.input(own.ID, e.booking("wed"))
	rerun.RequestChildID, rerun.ProvedOn = made[0].RequestChildID, decisionTestToday
	assert.Equal(t, capability.ContractEnrollmentExisting, e.enroll(t, rerun)[0].Status)
	// A second application of the child in the phase names itself.
	_, err = e.db.ExecContext(ctx, `UPDATE enrollment.request_children SET matched_student_id = ? WHERE tenant_id = ? AND id = ?`,
		own.ID, testpkg.Tenant(t), childID)
	require.NoError(t, err)
	held := e.enroll(t, rerun)
	assert.Equal(t, capability.ContractEnrollmentHasApplication, held[0].Status)
	assert.Equal(t, childID, held[0].RequestChildID)
}

// What the school no longer offers as care, or never derives care from, is
// not enrolled. An offering that stopped counting as care since the plan
// answers the child as changed: the plan booked it as care. A school with
// the care offerings switched off refuses every row before it reads or
// writes anything: an approval there writes no roster.
func TestContractEnrollmentRefusesCareTheSchoolDoesNotDerive(t *testing.T) {
	t.Parallel()
	e := setupContractEnrollment(t)
	ctx := testpkg.Ctx(t)
	student := e.student(t, "Lina")
	written := `SELECT (SELECT COUNT(*) FROM enrollment.requests WHERE tenant_id = ? AND submission_source = 'contract_import')
		+ (SELECT COUNT(*) FROM activities.student_enrollments WHERE tenant_id = ? AND student_id = ?)`
	together := e.input(student.ID, e.booking("mon"))

	// The offering stops counting as care between the plan and the
	// enrollment.
	planned := e.input(student.ID, e.booking("mon"))
	_, err := e.db.ExecContext(ctx, `UPDATE enrollment.care_offerings SET counts_as_care = false WHERE tenant_id = ? AND id = ?`,
		testpkg.Tenant(t), e.offering.ID)
	require.NoError(t, err)
	changed := []capability.ContractEnrollmentResult{{ContractID: e.contract, StudentID: student.ID, Status: capability.ContractEnrollmentChanged}}
	assert.Equal(t, changed, e.check(t, planned))
	assert.Equal(t, changed, e.enroll(t, planned))
	assert.Zero(t, e.count(t, written, testpkg.Tenant(t), testpkg.Tenant(t), student.ID), "nothing is written for it")

	// The school derives no care from bookings.
	off := false
	silent := newDecisionsForTestWithBookings(t, e.rolloverTestEnv, e.bookings, stubActivationSettings{careOfferingsEnabled: &off}, nil, nil, nil)
	inputs := []capability.ContractEnrollment{together, e.input(testpkg.UniqueTestTenantID(t), e.booking("mon"))}
	refused := []capability.ContractEnrollmentResult{
		{ContractID: e.contract, StudentID: inputs[0].StudentID, Status: capability.ContractEnrollmentRefused, Reason: capability.ContractEnrollmentCareOfferingsOff},
		{ContractID: e.contract, StudentID: inputs[1].StudentID, Status: capability.ContractEnrollmentRefused, Reason: capability.ContractEnrollmentCareOfferingsOff},
	}
	before := e.snapshot(t)
	checked, err := testpkg.TenantQuery1(t, ctx, e.db, silent.CheckContractChildren, inputs)
	require.NoError(t, err)
	assert.Equal(t, refused, checked)
	enrolled, err := testpkg.TenantQuery1(t, ctx, e.db, silent.EnrollContractChildren, inputs)
	require.NoError(t, err)
	assert.Equal(t, refused, enrolled, "every row, whatever else would hold it back")
	assert.Zero(t, e.count(t, written, testpkg.Tenant(t), testpkg.Tenant(t), student.ID))
	assert.Equal(t, before, e.snapshot(t))
}

// A run enrolled the child and stopped before the binding; since then the
// child left the school. The repeated call finds the stored enrollment but
// does not confirm it: a confirmation leads to the binding, and no contract
// is bound to the enrollment of a child record that is no longer active.
// The same holds for an application a row names. Nothing is written.
func TestContractEnrollmentConfirmsNoEnrollmentOfAnInactiveChildRecord(t *testing.T) {
	t.Parallel()
	e := setupContractEnrollment(t)
	ctx := testpkg.Ctx(t)
	student := e.student(t, "Nele")
	input := e.input(student.ID, e.booking("mon"))
	made := e.enroll(t, input)
	require.Equal(t, capability.ContractEnrollmentEnrolled, made[0].Status)
	require.Equal(t, capability.ContractEnrollmentExisting, e.enroll(t, input)[0].Status, "while the child record is active the run is repeatable")

	_, err := e.db.ExecContext(ctx, `UPDATE users.student_school_memberships SET status = 'inactive'
		WHERE tenant_id = ? AND student_profile_id = ?`, testpkg.Tenant(t), student.ID)
	require.NoError(t, err)
	refused := []capability.ContractEnrollmentResult{{ContractID: e.contract, StudentID: student.ID, Status: capability.ContractEnrollmentRefused,
		Reason: capability.ContractEnrollmentStudentInactive, RequestID: made[0].RequestID, RequestChildID: made[0].RequestChildID}}
	assert.Equal(t, refused, e.check(t, input))
	assert.Equal(t, refused, e.enroll(t, input), "the answer names the enrollment that stays unbound")

	named := input
	named.RequestChildID, named.ProvedOn = made[0].RequestChildID, calendar.Date(e.sourcePhase.ServiceStartDate)
	assert.Equal(t, refused, e.enroll(t, named), "an application the row names is not confirmed either")
}

// The office confirmed a preview that showed the child record as Lina
// Vertrag, born on 15 April 2018. Before the enrollment reads the child
// record under its gates, staff change the name, then the date of birth.
// The request child of a silent enrollment stores both: the enrollment
// answers changed and writes nothing, in the check as in the run. A row that
// carries the child record as it is now is enrolled with it, and a repeated
// call with a child record that changed again finds nothing to confirm.
func TestContractEnrollmentCreatesOnlyTheChildRecordTheOfficeConfirmed(t *testing.T) {
	t.Parallel()
	e := setupContractEnrollment(t)
	ctx := testpkg.Ctx(t)
	student := e.student(t, "Lina")
	born := calendar.NewDate(2018, 4, 15)
	confirmed := e.input(student.ID, e.booking("mon"))
	confirmed.Confirmed = &capability.ContractChildIdentity{FirstName: "Lina", LastName: "Vertrag", BirthDate: &born}
	require.Equal(t, capability.ContractEnrollmentEnrolled, e.check(t, confirmed)[0].Status, "the child record is what the office saw")

	person := func(set string) {
		t.Helper()
		_, err := e.db.ExecContext(ctx, `UPDATE users.persons SET `+set+` WHERE id = ?`, student.PersonID)
		require.NoError(t, err)
	}
	changed := []capability.ContractEnrollmentResult{{ContractID: e.contract, StudentID: student.ID, Status: capability.ContractEnrollmentChanged}}
	for name, set := range map[string][2]string{
		"first name":    {`first_name = 'Lena'`, `first_name = 'Lina'`},
		"last name":     {`last_name = 'Anders'`, `last_name = 'Vertrag'`},
		"date of birth": {`birthday = DATE '2018-04-16'`, `birthday = DATE '2018-04-15'`},
		"no birth date": {`birthday = NULL`, `birthday = DATE '2018-04-15'`},
	} {
		person(set[0])
		before := e.snapshot(t)
		assert.Equal(t, changed, e.check(t, confirmed), name)
		assert.Equal(t, changed, e.enroll(t, confirmed), name)
		assert.Zero(t, e.count(t, contractWritten, testpkg.Tenant(t), student.ID, testpkg.Tenant(t), student.ID), name)
		assert.Equal(t, before, e.snapshot(t), name)
		person(set[1])
	}

	// The office confirms a new preview after the school renamed the child.
	person(`first_name = 'Lena'`)
	renamed := confirmed
	renamed.Confirmed = &capability.ContractChildIdentity{FirstName: "Lena", LastName: "Vertrag", BirthDate: &born}
	enrolled := e.enroll(t, renamed)
	require.Equal(t, capability.ContractEnrollmentEnrolled, enrolled[0].Status)
	var stored string
	require.NoError(t, e.db.NewRaw(`SELECT first_name || ' ' || last_name || ' ' || date_of_birth::text FROM enrollment.request_children
		WHERE tenant_id = ? AND id = ?`, testpkg.Tenant(t), enrolled[0].RequestChildID).Scan(ctx, &stored))
	assert.Equal(t, "Lena Vertrag 2018-04-15", stored, "the request child stores what the office confirmed")
	assert.Equal(t, capability.ContractEnrollmentExisting, e.enroll(t, renamed)[0].Status)
	assert.Equal(t, capability.ContractEnrollmentChanged, e.enroll(t, confirmed)[0].Status,
		"a stored enrollment is not confirmed for a child record the office did not see")
}
