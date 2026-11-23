package enrollmenthttp_test

import (
	"testing"

	capability "github.com/moto-ogs/project-phoenix/modules/enrollment"
	enrollmentAPI "github.com/moto-ogs/project-phoenix/modules/enrollment/http"
	offeringContract "github.com/moto-ogs/project-phoenix/modules/enrollment/offeringcontract"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// A correction of the office changes only what the office changed (#7909).
// A booking that ends before its phase keeps its end when its offering stays
// chosen; an offering the correction adds is booked to the end of the phase
// or to the last care day of the child record.

// correctionEnv is a contract enrollment of one child with a booking of an
// offering a roster names as its source, Monday and Tuesday until the end
// of February, and a second offering the office may add.
type correctionEnv struct {
	*contractEnrollmentEnv
	bounded, added           *offeringContract.CareOfferingRecord
	roster                   *careTemplateGroup
	studentID                int64
	requestID, childID       int64
	beforeEnd, afterEnd      calendar.Date
	bookingEnd, phaseEndExcl calendar.Date
}

func setupCorrection(t *testing.T) *correctionEnv {
	t.Helper()
	e := setupContractEnrollment(t)
	bounded := e.careOffering(t, "Ganztag bis Februar", nil)
	added := e.careOffering(t, "Spätdienst", nil)
	period := offeringSourcePeriod(t, e.decisionTestEnv)
	roster := createSourcedTemplate(t, e.decisionTestEnv, "correction-bounded", bounded.ID, nil, period)
	c := &correctionEnv{contractEnrollmentEnv: e, bounded: bounded, added: added, roster: roster,
		beforeEnd: calendar.NewDate(2027, 2, 22), afterEnd: calendar.NewDate(2027, 3, 8),
		bookingEnd: calendar.NewDate(2027, 3, 1), phaseEndExcl: calendar.Date(e.sourcePhase.ServiceEndDate).AddDays(1)}
	for _, day := range []calendar.Date{c.beforeEnd, c.afterEnd} {
		testpkg.CreateTestActivityInstance(t, e.db, day, *roster.PlannedRoomID,
			testpkg.ActivityInstanceOpts{ActivityGroupID: &roster.ID, CalendarPeriodID: &period.ID})
	}
	student := e.student(t, "Lina")
	made := e.enroll(t, e.input(student.ID, bookingOf(bounded, calendar.Date(e.sourcePhase.ServiceStartDate), c.bookingEnd, "mon", "tue")))
	require.Equal(t, capability.ContractEnrollmentEnrolled, made[0].Status)
	c.studentID, c.requestID, c.childID = student.ID, made[0].RequestID, made[0].RequestChildID
	require.Equal(t, 1, c.rosterEndsOn(t, c.bookingEnd), "the roster row of the source rule ends with the booking")
	return c
}

func (c *correctionEnv) correct(t *testing.T, effectiveFrom *calendar.Date, offerings ...enrollmentAPI.OfferingAdjustmentSelection) {
	t.Helper()
	_, err := testpkg.TenantQuery1(t, testpkg.Ctx(t), c.db, c.owner.UpdateChildOfferings, enrollmentAPI.UpdateChildOfferingsInput{
		RequestID: c.requestID, ChildID: c.childID, ActorAccountID: c.creatorID, ActorRole: "admin",
		Reason: "Korrektur", Offerings: offerings, EffectiveFrom: effectiveFrom,
	})
	require.NoError(t, err)
}

// bookingEnds lists the exclusive ends of the child's bookings of one
// offering, in order.
func (c *correctionEnv) bookingEnds(t *testing.T, offeringID int64) []calendar.Date {
	t.Helper()
	var ends []calendar.Date
	require.NoError(t, c.db.NewRaw(`SELECT valid_until FROM enrollment.care_offering_bookings
		WHERE tenant_id = ? AND request_child_id = ? AND care_offering_id = ? ORDER BY valid_from`,
		testpkg.Tenant(t), c.childID, offeringID).Scan(testpkg.Ctx(t), &ends))
	return ends
}

func (c *correctionEnv) rosterEndsOn(t *testing.T, end calendar.Date) int {
	t.Helper()
	return c.count(t, `SELECT COUNT(*) FROM activities.student_enrollments WHERE tenant_id = ? AND student_id = ?
		AND activity_group_id = ? AND valid_until = ?`, testpkg.Tenant(t), c.studentID, c.roster.ID, end)
}

func (c *correctionEnv) rosterRowsPast(t *testing.T, end calendar.Date) int {
	t.Helper()
	return c.count(t, `SELECT COUNT(*) FROM activities.student_enrollments WHERE tenant_id = ? AND student_id = ?
		AND activity_group_id = ? AND (valid_until IS NULL OR valid_until > ?)`, testpkg.Tenant(t), c.studentID, c.roster.ID, end)
}

func (c *correctionEnv) onOccurrence(t *testing.T, day calendar.Date) int {
	t.Helper()
	return c.count(t, contractOccurrenceRows, testpkg.Tenant(t), c.studentID, c.roster.ID, day)
}

// The regression of #7909: the office corrects a weekday of a booking that
// ends with February, without a date. The booking, the roster row of the
// source rule and the child's occurrences still end with February. The
// same holds when the correction keeps the weekdays as they were.
func TestAnUndatedCorrectionKeepsTheEndOfABooking(t *testing.T) {
	t.Parallel()
	for name, days := range map[string][]string{"another weekday": {"mon"}, "the same weekdays": {"mon", "tue"}} {
		t.Run(name, func(t *testing.T) {
			testpkg.OwnTenant(t)
			t.Parallel()
			c := setupCorrection(t)
			c.correct(t, nil, enrollmentAPI.OfferingAdjustmentSelection{OfferingID: c.bounded.ID, SelectedDays: days})

			assert.Equal(t, []calendar.Date{c.bookingEnd}, c.bookingEnds(t, c.bounded.ID), "the booking keeps its end")
			assert.Equal(t, 1, c.rosterEndsOn(t, c.bookingEnd), "the roster row ends with the booking")
			assert.Zero(t, c.rosterRowsPast(t, c.bookingEnd), "no roster row runs past the booking")
			assert.Equal(t, 1, c.onOccurrence(t, c.beforeEnd), "on the Monday before the end")
			assert.Zero(t, c.onOccurrence(t, c.afterEnd), "on no occurrence after the end")
		})
	}
}

// An offering the correction adds is booked to the end of the phase, while
// the booking that stays chosen keeps its end.
func TestAnOfferingACorrectionAddsEndsWithThePhase(t *testing.T) {
	t.Parallel()
	c := setupCorrection(t)
	c.correct(t, nil,
		enrollmentAPI.OfferingAdjustmentSelection{OfferingID: c.bounded.ID, SelectedDays: []string{"mon", "tue"}},
		enrollmentAPI.OfferingAdjustmentSelection{OfferingID: c.added.ID, SelectedDays: []string{"wed"}})

	assert.Equal(t, []calendar.Date{c.bookingEnd}, c.bookingEnds(t, c.bounded.ID))
	assert.Equal(t, []calendar.Date{c.phaseEndExcl}, c.bookingEnds(t, c.added.ID), "the added offering is booked to the end of the phase")
}

// The last care day of the child record still caps every booking: the
// earlier of care end and booking end wins, and an added offering ends with
// the care end too, or with the phase when care goes on past it.
func TestACorrectionCapsKeptAndAddedBookingsAtTheCareEnd(t *testing.T) {
	t.Parallel()
	for name, careEnd := range map[string]calendar.Date{
		"care end before the booking end": calendar.NewDate(2027, 1, 31),
		"care end after the booking end":  calendar.NewDate(2027, 5, 31),
		"care end after the phase end":    calendar.NewDate(2027, 9, 30),
	} {
		t.Run(name, func(t *testing.T) {
			testpkg.OwnTenant(t)
			t.Parallel()
			c := setupCorrection(t)
			testpkg.SetStudentLifecycle(t, c.db, c.studentID, "active", nil, &careEnd)
			c.correct(t, nil,
				enrollmentAPI.OfferingAdjustmentSelection{OfferingID: c.bounded.ID, SelectedDays: []string{"mon"}},
				enrollmentAPI.OfferingAdjustmentSelection{OfferingID: c.added.ID, SelectedDays: []string{"wed"}})

			kept := c.bookingEnd
			if careEnd.AddDays(1).Before(kept) {
				kept = careEnd.AddDays(1)
			}
			assert.Equal(t, []calendar.Date{kept}, c.bookingEnds(t, c.bounded.ID), "the earlier end wins")
			added := careEnd.AddDays(1)
			if c.phaseEndExcl.Before(added) {
				added = c.phaseEndExcl
			}
			assert.Equal(t, []calendar.Date{added}, c.bookingEnds(t, c.added.ID), "the added offering ends with the care end or the phase")
		})
	}
}

// A co-booking ends with the last of its triggers, on the roster too. Two
// offerings book Monday until 15 February and 1 March; a co-booking they
// both trigger feeds a roster, and a switch to another offering is
// scheduled for May. The office removes the March trigger without a date:
// the co-booking and its roster row end on 15 February, and the child is on
// no occurrence after that day. The scheduled switch stays.
func TestACoBookingEndsWithItsLastTrigger(t *testing.T) {
	t.Parallel()
	e := setupContractEnrollment(t)
	early, late, may := e.careOffering(t, "Modul bis Februar", nil), e.careOffering(t, "Modul bis März", nil), e.careOffering(t, "Modul ab Mai", nil)
	coBooking := createAdjustmentCareOfferingWith(t, e.decisionTestEnv, "Mitbuchung "+t.Name(), func(o *offeringContract.CareOfferingRecord) {
		o.AutoAddTriggerOfferingIDs, o.SortOrder = []int64{early.ID, late.ID}, 101
	})
	period := offeringSourcePeriod(t, e.decisionTestEnv)
	roster := createSourcedTemplate(t, e.decisionTestEnv, "correction-co-booking", coBooking.ID, nil, period)
	february, march, afterFebruary := calendar.NewDate(2027, 2, 15), calendar.NewDate(2027, 3, 1), calendar.NewDate(2027, 2, 22)
	testpkg.CreateTestActivityInstance(t, e.db, afterFebruary, *roster.PlannedRoomID,
		testpkg.ActivityInstanceOpts{ActivityGroupID: &roster.ID, CalendarPeriodID: &period.ID})
	start := calendar.Date(e.sourcePhase.ServiceStartDate)
	student := e.student(t, "Lina")
	made := e.enroll(t, e.input(student.ID, bookingOf(early, start, february, "mon"), bookingOf(late, start, march, "mon")))
	require.Equal(t, capability.ContractEnrollmentEnrolled, made[0].Status)
	c := &correctionEnv{contractEnrollmentEnv: e, studentID: student.ID, requestID: made[0].RequestID, childID: made[0].RequestChildID, roster: roster}
	monday := func(id int64) enrollmentAPI.OfferingAdjustmentSelection {
		return enrollmentAPI.OfferingAdjustmentSelection{OfferingID: id, SelectedDays: []string{"mon"}}
	}
	c.correct(t, nil, monday(early.ID), monday(late.ID))
	require.Equal(t, []calendar.Date{march}, c.bookingEnds(t, coBooking.ID), "the co-booking ends with its last trigger")
	require.Equal(t, 1, c.rosterEndsOn(t, march))
	switchDay := calendar.NewDate(2027, 5, 3)
	c.correct(t, &switchDay, monday(may.ID))

	c.correct(t, nil, monday(early.ID))

	assert.Equal(t, []calendar.Date{contractRunDay, february}, c.bookingEnds(t, coBooking.ID),
		"with a scheduled switch the correction applies from today; the co-booking ends with the trigger that is left")
	assert.Equal(t, 1, c.rosterEndsOn(t, february), "its roster row ends there too")
	assert.Zero(t, c.rosterRowsPast(t, february))
	assert.Zero(t, c.onOccurrence(t, afterFebruary), "on no occurrence after the end")
	assert.Equal(t, []calendar.Date{calendar.Date(e.sourcePhase.ServiceEndDate).AddDays(1)}, c.bookingEnds(t, may.ID), "the scheduled switch stays")
}
