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

// What the enrollment of the children of imported care contracts refuses
// before it writes, since the third review round (#7760, ADR 0309): a
// booking its roster cannot end with, care past the care end of the child
// record, a window without one of its weekdays and a start that is still to
// come. And what holds afterwards: a repeated call compares the weekdays in
// effect, and an undated correction of the office keeps the first day.

// contractWritten counts the request children and the roster rows of one
// child record; its arguments are the tenant and the child record, twice.
const contractWritten = `SELECT (SELECT COUNT(*) FROM enrollment.request_children WHERE tenant_id = ? AND created_student_id = ?)
	+ (SELECT COUNT(*) FROM activities.student_enrollments WHERE tenant_id = ? AND student_id = ?)`

func (e *contractEnrollmentEnv) refused(studentID int64, reason string) []capability.ContractEnrollmentResult {
	return []capability.ContractEnrollmentResult{{ContractID: e.contract, StudentID: studentID,
		Status: capability.ContractEnrollmentRefused, Reason: reason}}
}

// careOffering is a care offering of the phase with an end time on every
// weekday, linked to roster directly when one is given.
func (e *contractEnrollmentEnv) careOffering(t *testing.T, name string, roster *int64) *offeringContract.CareOfferingRecord {
	t.Helper()
	return createAdjustmentCareOfferingWith(t, e.decisionTestEnv, name+" "+t.Name(), func(o *offeringContract.CareOfferingRecord) {
		o.ActivityGroupID, o.CountsAsCare, o.PickupTimes = roster, true, carePickupTimes("mon", "tue", "wed", "thu", "fri")
	})
}

// A booking that ends before its phase is refused when its offering names
// its roster through the direct link (ActivityGroupID): Care Plan writes the
// roster row of such an offering to the end of the phase whatever the
// booking says, so the child would stay on the roster and its occurrences
// after the booking ended. Two such bookings that end on different days on
// one roster are the same case. A check and a run answer alike, and nothing
// is written. A booking that ends early on an offering a roster names as its
// source is enrolled, and that roster row ends with the booking.
func TestContractEnrollmentRefusesABookingItsRosterCannotEndWith(t *testing.T) {
	t.Parallel()
	e := setupContractEnrollment(t)
	ctx := testpkg.Ctx(t)
	student := e.student(t, "Lina")
	start, until := calendar.Date(e.sourcePhase.ServiceStartDate), calendar.Date(e.sourcePhase.ServiceEndDate).AddDays(1)
	february := calendar.NewDate(2027, 3, 1)

	bounded := e.input(student.ID, bookingOf(e.offering, start, february, "tue"))
	assert.Equal(t, e.refused(student.ID, capability.ContractEnrollmentRosterBound), e.check(t, bounded))
	assert.Equal(t, e.refused(student.ID, capability.ContractEnrollmentRosterBound), e.enroll(t, bounded))

	// Two offerings feed one roster and end apart: Monday in February,
	// Wednesday with the phase.
	shared := testpkg.CreateTestActivityGroup(t, e.db, "ContractSharedRoster")
	monday, wednesday := e.careOffering(t, "Modul Montag", &shared.ID), e.careOffering(t, "Modul Mittwoch", &shared.ID)
	apart := e.input(student.ID, bookingOf(monday, start, february, "mon"), bookingOf(wednesday, start, until, "wed"))
	assert.Equal(t, e.refused(student.ID, capability.ContractEnrollmentRosterBound), e.check(t, apart))
	assert.Equal(t, e.refused(student.ID, capability.ContractEnrollmentRosterBound), e.enroll(t, apart))
	assert.Zero(t, e.count(t, contractWritten, testpkg.Tenant(t), student.ID, testpkg.Tenant(t), student.ID), "nothing is written for a refused row")
	together := e.input(student.ID, bookingOf(monday, start, until, "mon"), bookingOf(wednesday, start, until, "wed"))
	assert.Equal(t, capability.ContractEnrollmentEnrolled, e.check(t, together)[0].Status, "bookings that run to the end of the phase share the row")

	// An offering without a direct link, named by a roster as its source.
	sourcedOffering := e.careOffering(t, "Ganztag bis Februar", nil)
	sourced := createSourcedTemplate(t, e.decisionTestEnv, "contract-roster-end-sourced", sourcedOffering.ID, nil, offeringSourcePeriod(t, e.decisionTestEnv))
	result := e.enroll(t, e.input(student.ID, bookingOf(sourcedOffering, start, february, "mon")))
	require.Equal(t, capability.ContractEnrollmentEnrolled, result[0].Status)
	var ends calendar.Date
	require.NoError(t, e.db.NewRaw(`SELECT valid_until FROM activities.student_enrollments WHERE tenant_id = ? AND student_id = ?
		AND activity_group_id = ?`, testpkg.Tenant(t), student.ID, sourced.ID).Scan(ctx, &ends))
	assert.Equal(t, february, ends, "the roster row of a source rule ends with the booking, exclusive")
}

// A recorded care end holds the row: a child record whose last care day
// lies before the last day of the bookings is refused, in a check and in a
// run, and nothing is written. A care end on the last day of the bookings
// or after it holds nothing back.
func TestContractEnrollmentRefusesCarePastTheCareEndOfTheChildRecord(t *testing.T) {
	t.Parallel()
	e := setupContractEnrollment(t)
	leaving, staying := e.student(t, "Lina"), e.student(t, "Mats")
	spring, last := calendar.NewDate(2027, 3, 31), calendar.Date(e.sourcePhase.ServiceEndDate)
	testpkg.SetStudentLifecycle(t, e.db, leaving.ID, "active", nil, &spring)
	testpkg.SetStudentLifecycle(t, e.db, staying.ID, "active", nil, &last)

	inputs := []capability.ContractEnrollment{e.input(leaving.ID, e.booking("mon")), e.input(staying.ID, e.booking("mon"))}
	checked := e.check(t, inputs...)
	assert.Equal(t, e.refused(leaving.ID, capability.ContractEnrollmentCareEndsEarlier)[0], checked[0])
	assert.Equal(t, capability.ContractEnrollmentEnrolled, checked[1].Status)
	before := e.snapshot(t)
	enrolled := e.enroll(t, inputs...)
	assert.Equal(t, e.refused(leaving.ID, capability.ContractEnrollmentCareEndsEarlier)[0], enrolled[0])
	assert.Equal(t, capability.ContractEnrollmentEnrolled, enrolled[1].Status, "the other row goes on")
	assert.Zero(t, e.count(t, contractWritten, testpkg.Tenant(t), leaving.ID, testpkg.Tenant(t), leaving.ID))
	assert.Equal(t, before, e.snapshot(t))

	// The bookings that end with the care end are enrolled.
	sourcedOffering := e.careOffering(t, "Ganztag bis März", nil)
	within := e.input(leaving.ID, bookingOf(sourcedOffering, calendar.Date(e.sourcePhase.ServiceStartDate), spring.AddDays(1), "mon"))
	assert.Equal(t, capability.ContractEnrollmentEnrolled, e.check(t, within)[0].Status)
}

// A short window does not abort the run. The contract starts on Thursday 29
// July, the service of the phase ends on Saturday 31 July, and the offering
// feeds a roster with a Monday and a Friday. Care Plan's roster check asks
// for every booked weekday within the window and would answer the Monday
// with an error for the whole call. The row is refused instead, with its
// reason, and the other rows of the call are enrolled; a booking whose
// weekdays lie in the window gets its roster. A start that is still to come
// is refused too: the plan books no contract and no phase before it began.
func TestContractEnrollmentRefusesAWindowWithoutItsWeekdays(t *testing.T) {
	t.Parallel()
	e := setupContractEnrollment(t)
	ctx := testpkg.Ctx(t)
	template, period := linkedRoster(t, e, "contract-short-window", weekdayMonday)
	createCareOfferingTemplateSchedule(t, e.db, template.ID, timetable.WeekdayFriday, &period.ID)
	offering := e.careOffering(t, "Ganztag Juli", &template.ID)
	thursday, until := calendar.NewDate(2027, 7, 29), calendar.Date(e.sourcePhase.ServiceEndDate).AddDays(1)
	short, fits, other := e.student(t, "Lina"), e.student(t, "Mats"), e.student(t, "Nele")

	// The run day lies before the window: such a start is still to come.
	early := e.check(t, e.input(fits.ID, bookingOf(offering, thursday, until, "fri")))
	assert.Equal(t, e.refused(fits.ID, capability.ContractEnrollmentBookingWindow), early, "no child is enrolled from a day after today")
	tomorrow := e.booking("mon")
	tomorrow.ValidFrom = contractRunDay.AddDays(1)
	assert.Equal(t, e.refused(fits.ID, capability.ContractEnrollmentBookingWindow), e.enroll(t, e.input(fits.ID, tomorrow)))
	assert.Zero(t, e.count(t, contractWritten, testpkg.Tenant(t), fits.ID, testpkg.Tenant(t), fits.ID))

	e.today = thursday
	inputs := []capability.ContractEnrollment{
		e.input(short.ID, bookingOf(offering, thursday, until, "mon", "fri")),
		e.input(fits.ID, bookingOf(offering, thursday, until, "fri")),
		e.input(other.ID, e.booking("mon")),
	}
	checked := e.check(t, inputs...)
	assert.Equal(t, e.refused(short.ID, capability.ContractEnrollmentWindowTooShort)[0], checked[0])
	results := e.enroll(t, inputs...)
	assert.Equal(t, e.refused(short.ID, capability.ContractEnrollmentWindowTooShort)[0], results[0], "refused, not an error of the call")
	assert.Equal(t, capability.ContractEnrollmentEnrolled, results[1].Status)
	assert.Equal(t, capability.ContractEnrollmentEnrolled, results[2].Status, "the other rows of the call are enrolled")
	assert.Zero(t, e.count(t, contractWritten, testpkg.Tenant(t), short.ID, testpkg.Tenant(t), short.ID))
	var from calendar.Date
	require.NoError(t, e.db.NewRaw(`SELECT valid_from FROM activities.student_enrollments WHERE tenant_id = ? AND student_id = ?
		AND activity_group_id = ?`, testpkg.Tenant(t), fits.ID, template.ID).Scan(ctx, &from))
	assert.Equal(t, thursday, from, "the Friday of the window gets its roster")
}

// A repeated call compares the weekdays a booking holds in effect. The
// enrollment booked the lunch on Tuesday. Then the office corrected the
// bookings without a date, and the rule that books the lunch along with the
// care added Monday to it: the lunch holds Monday and Tuesday now, of which
// the office ticked only Tuesday. The repeated call with the bookings of
// the plan is not answered as existing.
func TestContractEnrollmentComparesTheWeekdaysInEffect(t *testing.T) {
	t.Parallel()
	e := setupContractEnrollment(t)
	ctx := testpkg.Ctx(t)
	care := e.careOffering(t, "Betreuung", nil)
	lunch := createAdjustmentCareOfferingWith(t, e.decisionTestEnv, "Mittagessen "+t.Name(), func(o *offeringContract.CareOfferingRecord) {
		o.CountsAsCare, o.PickupTimes = true, carePickupTimes("mon", "tue", "wed", "thu", "fri")
		o.AutoAddTriggerOfferingIDs, o.SortOrder = []int64{care.ID}, 101
	})
	start, until := calendar.Date(e.sourcePhase.ServiceStartDate), calendar.Date(e.sourcePhase.ServiceEndDate).AddDays(1)
	student := e.student(t, "Lina")
	input := e.input(student.ID, bookingOf(care, start, until, "mon"), bookingOf(lunch, start, until, "tue"))
	made := e.enroll(t, input)
	require.Equal(t, capability.ContractEnrollmentEnrolled, made[0].Status)
	assert.Equal(t, capability.ContractEnrollmentExisting, e.enroll(t, input)[0].Status)

	_, err := testpkg.TenantQuery1(t, ctx, e.db, e.owner.UpdateChildOfferings, enrollmentAPI.UpdateChildOfferingsInput{
		RequestID: made[0].RequestID, ChildID: made[0].RequestChildID, ActorAccountID: e.creatorID, ActorRole: "admin",
		Reason: "Korrektur", Offerings: []enrollmentAPI.OfferingAdjustmentSelection{
			{OfferingID: care.ID, SelectedDays: []string{"mon"}}, {OfferingID: lunch.ID, SelectedDays: []string{"tue"}}},
	})
	require.NoError(t, err)
	stored, err := testpkg.TenantQuery1(t, ctx, e.db, e.repos.Enrollment().RequestChildOfferingHistory, made[0].RequestChildID)
	require.NoError(t, err)
	for _, row := range stored {
		if row.CareOfferingID == lunch.ID {
			require.Equal(t, []string{"tue"}, row.ManualSelectedDays, "the office ticked what the enrollment booked")
			require.Equal(t, []string{"mon"}, row.AutomaticSelectedDays, "the rule added a weekday")
		}
	}
	again := e.enroll(t, input)
	assert.Equal(t, capability.ContractEnrollmentRefused, again[0].Status)
	assert.Equal(t, capability.ContractEnrollmentBookingsDiffer, again[0].Reason, "the lunch holds another weekday in effect")
	assert.Equal(t, made[0].RequestChildID, again[0].RequestChildID)
	effective := e.input(student.ID, bookingOf(care, start, until, "mon"), bookingOf(lunch, start, until, "mon", "tue"))
	assert.Equal(t, capability.ContractEnrollmentExisting, e.enroll(t, effective)[0].Status, "a plan of the bookings in effect finds the enrollment")
}

// An undated correction of the office keeps the first day of the bookings.
// The child is enrolled from 4 January in a phase whose service starts on 1
// September. The office then corrects its weekdays on the usual way,
// without a date. The bookings and the roster rows, on the roster of the
// direct link and on the one of a source rule, still start on 4 January,
// and the child is on no occurrence before that day. A child of an
// application is corrected from the service start of the phase, as before.
func TestAnUndatedCorrectionKeepsTheStartOfAContractEnrollment(t *testing.T) {
	t.Parallel()
	e := setupContractEnrollment(t)
	ctx := testpkg.Ctx(t)
	linked, linkedPeriod := linkedRoster(t, e, "contract-corrected-linked", timetable.WeekdayTuesday)
	createCareOfferingTemplateSchedule(t, e.db, linked.ID, weekdayMonday, &linkedPeriod.ID)
	offering := e.careOffering(t, "Ganztag ab Januar", &linked.ID)
	sourcedPeriod := offeringSourcePeriod(t, e.decisionTestEnv)
	sourced := createSourcedTemplate(t, e.decisionTestEnv, "contract-corrected-sourced", offering.ID, nil, sourcedPeriod)
	careStart, serviceStart := contractRunDay, calendar.Date(e.sourcePhase.ServiceStartDate)
	autumn := map[*careTemplateGroup]calendar.Date{linked: calendar.NewDate(2026, 12, 15), sourced: calendar.NewDate(2026, 12, 14)}
	winter := map[*careTemplateGroup]calendar.Date{linked: calendar.NewDate(2027, 1, 11), sourced: calendar.NewDate(2027, 1, 11)}
	periods := map[*careTemplateGroup]*calendarPeriod{linked: linkedPeriod, sourced: sourcedPeriod}
	for _, days := range []map[*careTemplateGroup]calendar.Date{autumn, winter} {
		for template, day := range days {
			testpkg.CreateTestActivityInstance(t, e.db, day, *template.PlannedRoomID,
				testpkg.ActivityInstanceOpts{ActivityGroupID: &template.ID, CalendarPeriodID: &periods[template].ID})
		}
	}
	student := e.student(t, "Lina")
	made := e.enroll(t, e.input(student.ID, bookingOf(offering, careStart, calendar.Date(e.sourcePhase.ServiceEndDate).AddDays(1), "mon", "tue")))
	require.Equal(t, capability.ContractEnrollmentEnrolled, made[0].Status)

	correct := func(requestID, childID int64, days ...string) {
		_, err := testpkg.TenantQuery1(t, ctx, e.db, e.owner.UpdateChildOfferings, enrollmentAPI.UpdateChildOfferingsInput{
			RequestID: requestID, ChildID: childID, ActorAccountID: e.creatorID, ActorRole: "admin",
			Reason: "Korrektur der Wochentage", Offerings: []enrollmentAPI.OfferingAdjustmentSelection{{OfferingID: offering.ID, SelectedDays: days}},
		})
		require.NoError(t, err)
	}
	correct(made[0].RequestID, made[0].RequestChildID, "mon")

	bookings := `SELECT COUNT(*) FROM enrollment.care_offering_bookings WHERE tenant_id = ? AND request_child_id = ?`
	assert.Equal(t, 1, e.count(t, bookings+` AND valid_from = ? AND manual_selected_days = '["mon"]'::jsonb`, testpkg.Tenant(t), made[0].RequestChildID, careStart),
		"the corrected booking starts with the contract")
	assert.Zero(t, e.count(t, bookings+` AND (valid_from IS NULL OR valid_from < ?)`, testpkg.Tenant(t), made[0].RequestChildID, careStart),
		"no booking reaches back before the contract")
	rosters := `SELECT COUNT(*) FROM activities.student_enrollments WHERE tenant_id = ? AND student_id = ?`
	assert.Zero(t, e.count(t, rosters+` AND valid_from < ?`, testpkg.Tenant(t), student.ID, careStart), "no roster row reaches back before the contract")
	for name, template := range map[string]*careTemplateGroup{"direct link": linked, "source rule": sourced} {
		assert.Equal(t, 1, e.count(t, rosters+` AND activity_group_id = ? AND valid_from = ?`, testpkg.Tenant(t), student.ID, template.ID, careStart),
			"%s: the roster row starts with the contract", name)
		assert.Zero(t, e.count(t, contractOccurrenceRows, testpkg.Tenant(t), student.ID, template.ID, autumn[template]),
			"%s: on no occurrence before the contract", name)
		assert.Equal(t, 1, e.count(t, contractOccurrenceRows, testpkg.Tenant(t), student.ID, template.ID, winter[template]),
			"%s: on the Monday after the correction", name)
	}

	// A child of an application is booked over the whole phase and stays so.
	requestID, childID, applied := submitApprovedAdjustmentChild(t, e.decisionTestEnv, "contract-corrected@example.com", "Antrag",
		[]*offeringContract.CareOfferingRecord{offering})
	correct(requestID, childID, "mon", "tue")
	assert.Equal(t, 1, e.count(t, bookings+` AND valid_from = ?`, testpkg.Tenant(t), childID, serviceStart), "booked from the service start")
	assert.Equal(t, 1, e.count(t, rosters+` AND activity_group_id = ? AND valid_from = ?`, testpkg.Tenant(t), applied, linked.ID, serviceStart),
		"and on the roster from the service start")
}

// A booking of an offering the school deactivated gets no new enrollment. A
// roster that names several offerings as its sources leaves an inactive one
// out, so the child would be approved, and its contract bound, on no roster.
// A check and a run answer alike, nothing is written, and the other rows of
// the call go on.
func TestContractEnrollmentRefusesAnInactiveOffering(t *testing.T) {
	t.Parallel()
	e := setupContractEnrollment(t)
	inactive := e.careOffering(t, "Modul A", nil)
	e.setOffering(t, inactive.ID, "is_active = FALSE")
	start, until := calendar.Date(e.sourcePhase.ServiceStartDate), calendar.Date(e.sourcePhase.ServiceEndDate).AddDays(1)
	held, other := e.student(t, "Lina"), e.student(t, "Mats")

	inputs := []capability.ContractEnrollment{e.input(held.ID, bookingOf(inactive, start, until, "mon")), e.input(other.ID, e.booking("mon"))}
	checked := e.check(t, inputs...)
	assert.Equal(t, e.refused(held.ID, capability.ContractEnrollmentOfferingInactive)[0], checked[0])
	assert.Equal(t, capability.ContractEnrollmentEnrolled, checked[1].Status)
	enrolled := e.enroll(t, inputs...)
	assert.Equal(t, e.refused(held.ID, capability.ContractEnrollmentOfferingInactive)[0], enrolled[0])
	assert.Equal(t, capability.ContractEnrollmentEnrolled, enrolled[1].Status, "the other row goes on")
	assert.Zero(t, e.count(t, contractWritten, testpkg.Tenant(t), held.ID, testpkg.Tenant(t), held.ID), "nothing is written for a refused row")

	// One inactive offering among the bookings refuses the child.
	mixed := e.input(held.ID, e.booking("mon"), bookingOf(inactive, start, until, "tue"))
	assert.Equal(t, e.refused(held.ID, capability.ContractEnrollmentOfferingInactive), e.check(t, mixed))
}

// setOffering changes a care offering of the school in place, as the office
// does after a run: change is the SET clause.
func (e *contractEnrollmentEnv) setOffering(t *testing.T, offeringID int64, change string, args ...any) {
	t.Helper()
	_, err := e.db.ExecContext(testpkg.Ctx(t), `UPDATE enrollment.care_offerings SET `+change+` WHERE tenant_id = ? AND id = ?`,
		append(args, testpkg.Tenant(t), offeringID)...)
	require.NoError(t, err)
}

// A repeated call confirms its own stored enrollment whatever only guards a
// new one. The run enrolled the child with a booking that ends in February
// and stopped before the binding. Then the office linked the offering to a
// roster directly and deactivated it: a new enrollment with that booking is
// refused (roster_bound, offering_inactive). The repeated call for the
// enrolled child still answers existing, so its contract gets bound, and
// writes nothing. Other bookings than the stored ones are still refused.
func TestARepeatedContractEnrollmentConfirmsItsStoredEnrollment(t *testing.T) {
	t.Parallel()
	e := setupContractEnrollment(t)
	offering := e.careOffering(t, "Ganztag bis Februar", nil)
	start, february := calendar.Date(e.sourcePhase.ServiceStartDate), calendar.NewDate(2027, 3, 1)
	enrolled, later := e.student(t, "Lina"), e.student(t, "Mats")
	input := e.input(enrolled.ID, bookingOf(offering, start, february, "mon"))
	made := e.enroll(t, input)
	require.Equal(t, capability.ContractEnrollmentEnrolled, made[0].Status)
	written := e.count(t, contractWritten, testpkg.Tenant(t), enrolled.ID, testpkg.Tenant(t), enrolled.ID)

	guards := []struct{ change, reason string }{
		{"activity_group_id = ?", capability.ContractEnrollmentRosterBound},
		{"is_active = FALSE, activity_group_id = NULL", capability.ContractEnrollmentOfferingInactive},
	}
	for _, guard := range guards {
		args := []any{}
		if guard.reason == capability.ContractEnrollmentRosterBound {
			args = append(args, e.groupID)
		}
		e.setOffering(t, offering.ID, guard.change, args...)
		assert.Equal(t, e.refused(later.ID, guard.reason), e.check(t, e.input(later.ID, bookingOf(offering, start, february, "mon"))),
			"a new enrollment is refused")
		for name, answer := range map[string][]capability.ContractEnrollmentResult{"check": e.check(t, input), "run": e.enroll(t, input)} {
			assert.Equal(t, capability.ContractEnrollmentExisting, answer[0].Status, "%s after %s", name, guard.reason)
			assert.Empty(t, answer[0].Reason, name)
			assert.Equal(t, made[0].RequestChildID, answer[0].RequestChildID, name)
		}
	}
	assert.Equal(t, written, e.count(t, contractWritten, testpkg.Tenant(t), enrolled.ID, testpkg.Tenant(t), enrolled.ID), "a repeated call writes nothing")

	other := e.enroll(t, e.input(enrolled.ID, bookingOf(offering, start, february, "tue")))
	assert.Equal(t, capability.ContractEnrollmentRefused, other[0].Status)
	assert.Equal(t, capability.ContractEnrollmentBookingsDiffer, other[0].Reason, "other bookings are not the stored enrollment")
}

// A contract has one silent enrollment, whatever its phase. A run enrolled
// the child in a phase and the binding did not follow; the office then
// corrected the unbound contract to an offering of a second phase that
// overlaps the first. That phase holds no application of the child, so only
// the read across the phases finds the enrollment: the row is refused
// (enrolled_elsewhere), names that enrollment and writes nothing, in a check
// and in a run. Another contract of the child is not held back by it.
func TestContractEnrollmentRefusesASecondEnrollmentOfItsContractInAnotherPhase(t *testing.T) {
	t.Parallel()
	e := setupContractEnrollment(t)
	ctx := testpkg.Ctx(t)
	student := e.student(t, "Nora")
	first := e.enroll(t, e.input(student.ID, e.booking("mon", "wed")))
	require.Equal(t, capability.ContractEnrollmentEnrolled, first[0].Status)
	written := e.count(t, contractWritten, testpkg.Tenant(t), student.ID, testpkg.Tenant(t), student.ID)

	second := *e.sourcePhase
	second.ID, second.Name = 0, "Zweite Phase "+t.Name()
	require.NoError(t, InsertOwnerPhaseForTest(ctx, e.repos.Enrollment(), &second))
	offering := createAdjustmentCareOfferingWith(t, e.decisionTestEnv, "Ganztag zweite Phase "+t.Name(), func(o *offeringContract.CareOfferingRecord) {
		o.PhaseID, o.CountsAsCare, o.PickupTimes = second.ID, true, carePickupTimes("mon", "tue", "wed", "thu", "fri")
	})
	corrected := e.input(student.ID, bookingOf(offering, calendar.Date(second.ServiceStartDate), calendar.Date(second.ServiceEndDate).AddDays(1), "mon", "wed"))
	corrected.PhaseID = second.ID

	want := []capability.ContractEnrollmentResult{{ContractID: e.contract, StudentID: student.ID, Status: capability.ContractEnrollmentRefused,
		Reason: capability.ContractEnrollmentEnrolledElsewhere, RequestID: first[0].RequestID, RequestChildID: first[0].RequestChildID}}
	assert.Equal(t, want, e.check(t, corrected), "the check names the enrollment of the first phase")
	assert.Equal(t, want, e.enroll(t, corrected), "the run enrolls the child in no second phase")
	assert.Equal(t, written, e.count(t, contractWritten, testpkg.Tenant(t), student.ID, testpkg.Tenant(t), student.ID), "nothing is written")

	other := corrected
	other.ContractID = e.contract + 1
	assert.Equal(t, capability.ContractEnrollmentEnrolled, e.check(t, other)[0].Status,
		"the enrollment of one contract does not hold back another contract of the child")
}
