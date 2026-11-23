package contracttest_test

import (
	"testing"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/careplan"
	offeringContract "github.com/moto-ogs/project-phoenix/modules/enrollment/offeringcontract"
	"github.com/moto-ogs/project-phoenix/modules/timetable"
	timetableCompose "github.com/moto-ogs/project-phoenix/modules/timetable/compose"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// A change with a date keeps the end of a booking whose offering stays
// chosen (#7928), the way an undated correction does (#7909). The child of
// the fixture is booked into the old offering on Monday until four weeks
// after the switch date; the change moves the booking to Tuesday from the
// switch date on.

// boundedOfferingChange is the offering-change fixture with the booking of
// the old offering ending at bookingEnd.
type boundedOfferingChange struct {
	*offeringChangeFixture
	env        *decisionTestEnv
	svc        careplan.OfferingChangeCapability
	bookingEnd calendar.Date
	label      string
}

func setupBoundedOfferingChange(t *testing.T, label string) *boundedOfferingChange {
	t.Helper()
	env := setupDecisionTest(t)
	svc := newOfferingChangeServiceForTest(t, env)
	fx := setupOfferingChangeFixture(t, env, label)
	c := &boundedOfferingChange{offeringChangeFixture: fx, env: env, svc: svc, bookingEnd: fx.switchDate.AddDays(28), label: label}
	_, err := env.db.ExecContext(testpkg.Ctx(t), `UPDATE enrollment.care_offering_bookings SET valid_until = ?
		WHERE tenant_id = ? AND request_child_id = ?`, c.bookingEnd, testpkg.Tenant(t), fx.childID)
	require.NoError(t, err)
	return c
}

// tuesday is the old offering on Tuesday instead of Monday.
func (c *boundedOfferingChange) tuesday() []careplan.OfferingChangeSelection {
	return []careplan.OfferingChangeSelection{{OfferingID: c.oldOffering.ID, SelectedDays: []string{"tue"}}}
}

// bookingEnds lists the exclusive ends of the child's bookings of the old
// offering, in order.
func (c *boundedOfferingChange) bookingEnds(t *testing.T) []calendar.Date {
	t.Helper()
	var ends []calendar.Date
	require.NoError(t, c.env.db.NewRaw(`SELECT valid_until FROM enrollment.care_offering_bookings
		WHERE tenant_id = ? AND request_child_id = ? AND care_offering_id = ? ORDER BY valid_from`,
		testpkg.Tenant(t), c.childID, c.oldOffering.ID).Scan(testpkg.Ctx(t), &ends))
	return ends
}

// takeTheSlotAfterTheEnd limits the old offering to one place and books
// another child into it from the end of the booking on: the place is free
// only for as long as the booking runs.
func (c *boundedOfferingChange) takeTheSlotAfterTheEnd(t *testing.T) {
	t.Helper()
	one := 1
	c.oldOffering.Capacity = &one
	require.NoError(t, newCareOfferingFixtureRecords(c.env.repos.CarePlan()).Update(offeringChangeAdminContext(t), c.oldOffering))
	_, otherChild, _ := submitApprovedAdjustmentChild(t, c.env, "after-the-end-"+c.label+"@example.com", "Danach"+c.label,
		[]*offeringContract.CareOfferingRecord{c.oldOffering})
	_, err := c.env.db.ExecContext(testpkg.Ctx(t), `UPDATE enrollment.care_offering_bookings SET valid_from = ?
		WHERE tenant_id = ? AND request_child_id = ?`, c.bookingEnd, testpkg.Tenant(t), otherChild)
	require.NoError(t, err)
}

func (c *boundedOfferingChange) submit(t *testing.T) *careplan.OfferingChangeRequest {
	t.Helper()
	row, err := testpkg.TenantQuery1(t, offeringChangeAdminContext(t), testpkg.SetupTestDB(t), c.svc.SubmitOfferingChange, careplan.CreateOfferingChangeInput{
		StudentID: c.studentID, AccountID: c.env.creatorID, EffectiveFrom: c.switchDate, Selections: c.tuesday(),
	})
	require.NoError(t, err)
	return row
}

func (c *boundedOfferingChange) approve(t *testing.T, row *careplan.OfferingChangeRequest) error {
	t.Helper()
	return testpkg.TenantCommand1(t, offeringChangeAdminContext(t), testpkg.SetupTestDB(t), decidesOfferingChange(c.svc), careplan.OfferingChangeDecisionInput{
		RequestID: row.ID, Approve: true, ReviewedBy: c.env.creatorID,
	})
}

func (c *boundedOfferingChange) direct(t *testing.T) (careplan.DirectOfferingAdjustments, careplan.DirectOfferingAdjustmentInput) {
	t.Helper()
	direct, ok := c.svc.(careplan.DirectOfferingAdjustments)
	require.True(t, ok)
	return direct, careplan.DirectOfferingAdjustmentInput{
		StudentID: c.studentID, EffectiveFrom: c.switchDate, Selections: c.tuesday(),
		Reason: "Gehzeit", ActorAccountID: c.env.creatorID, ActorRole: "admin",
	}
}

// The approval of a parent request keeps the end: the booking runs on
// Tuesday from the switch date to its end, not to the end of the phase.
func TestAnApprovedRequestKeepsTheEndOfABooking(t *testing.T) {
	t.Parallel()
	c := setupBoundedOfferingChange(t, "ApprovedKeepsEnd")

	require.NoError(t, c.approve(t, c.submit(t)))

	assert.Equal(t, []calendar.Date{c.switchDate, c.bookingEnd}, c.bookingEnds(t), "the booking keeps its end")
}

// A direct adjustment, the write of a permanent pickup-time change, keeps
// the end too.
func TestADirectAdjustmentKeepsTheEndOfABooking(t *testing.T) {
	t.Parallel()
	c := setupBoundedOfferingChange(t, "DirectKeepsEnd")
	direct, input := c.direct(t)

	_, err := testpkg.TenantQuery1(t, offeringChangeAdminContext(t), testpkg.SetupTestDB(t), direct.ApplyDirectOfferingAdjustment, input)
	require.NoError(t, err)

	assert.Equal(t, []calendar.Date{c.switchDate, c.bookingEnd}, c.bookingEnds(t), "the booking keeps its end")
}

// The capacity check reads the window the change books. The only place of
// the old offering is taken by another child from the end of the booking
// on; the change keeps the end, so it needs no place after it. The preview
// and the approval of a request, and the check and the write of a direct
// adjustment, all let it through.
func TestTheCapacityCheckOfAChangeReadsTheWindowItBooks(t *testing.T) {
	t.Parallel()
	t.Run("approval", func(t *testing.T) {
		testpkg.OwnTenant(t)
		t.Parallel()
		c := setupBoundedOfferingChange(t, "CapacityApproval")
		row := c.submit(t)
		c.takeTheSlotAfterTheEnd(t)

		_, err := testpkg.TenantQuery3(t, offeringChangeAdminContext(t), testpkg.SetupTestDB(t), c.svc.PreviewDecision, row.ID, []int64(nil), (*calendar.Date)(nil))
		require.NoError(t, err, "the preview finds the place free for as long as the booking runs")
		require.NoError(t, c.approve(t, row))
		assert.Equal(t, []calendar.Date{c.switchDate, c.bookingEnd}, c.bookingEnds(t))
	})
	t.Run("direct adjustment", func(t *testing.T) {
		testpkg.OwnTenant(t)
		t.Parallel()
		c := setupBoundedOfferingChange(t, "CapacityDirect")
		c.takeTheSlotAfterTheEnd(t)
		direct, input := c.direct(t)

		require.NoError(t, testpkg.TenantCommand1(t, offeringChangeAdminContext(t), testpkg.SetupTestDB(t), direct.PrepareDirectOfferingAdjustment, input),
			"the check finds the place free for as long as the booking runs")
		_, err := testpkg.TenantQuery1(t, offeringChangeAdminContext(t), testpkg.SetupTestDB(t), direct.ApplyDirectOfferingAdjustment, input)
		require.NoError(t, err)
		assert.Equal(t, []calendar.Date{c.switchDate, c.bookingEnd}, c.bookingEnds(t))
	})
}

// A co-booking the change adds ends with its trigger, so its capacity
// window ends there too. The co-booking has one place, taken by another
// child from the end of the trigger's booking on; the change still fits.
func TestTheCapacityCheckOfANewCoBookingEndsWithItsTrigger(t *testing.T) {
	t.Parallel()
	c := setupBoundedOfferingChange(t, "CapacityCoBooking")
	one := 1
	coBooking := createAdjustmentCareOfferingWith(t, c.env, "Mitbuchung CapacityCoBooking", func(o *offeringContract.CareOfferingRecord) {
		o.AutoAddTriggerOfferingIDs, o.SortOrder, o.Capacity = []int64{c.oldOffering.ID}, 203, &one
	})
	_, otherChild, _ := submitApprovedAdjustmentChild(t, c.env, "co-booking-after-the-end@example.com", "DanachMitbuchung",
		[]*offeringContract.CareOfferingRecord{coBooking})
	_, err := c.env.db.ExecContext(testpkg.Ctx(t), `UPDATE enrollment.care_offering_bookings SET valid_from = ?
		WHERE tenant_id = ? AND request_child_id = ?`, c.bookingEnd, testpkg.Tenant(t), otherChild)
	require.NoError(t, err)
	row := c.submit(t)

	_, err = testpkg.TenantQuery3(t, offeringChangeAdminContext(t), testpkg.SetupTestDB(t), c.svc.PreviewDecision, row.ID, []int64(nil), (*calendar.Date)(nil))
	require.NoError(t, err, "the place of the co-booking is free for as long as its trigger runs")
	require.NoError(t, c.approve(t, row))
	var ends []calendar.Date
	require.NoError(t, c.env.db.NewRaw(`SELECT valid_until FROM enrollment.care_offering_bookings
		WHERE tenant_id = ? AND request_child_id = ? AND care_offering_id = ?`,
		testpkg.Tenant(t), c.childID, coBooking.ID).Scan(testpkg.Ctx(t), &ends))
	assert.Equal(t, []calendar.Date{c.bookingEnd}, ends, "the co-booking ends with its trigger")
}

// The preview warns about manual planning the change leaves without care
// after the end it keeps. The old offering counts as care; a manual
// occurrence on a Tuesday before the end is covered, one after it is not.
func TestThePreviewWarnsAboutManualPlanningAfterAKeptEnd(t *testing.T) {
	t.Parallel()
	c := setupBoundedOfferingChange(t, "PreviewKeptEnd")
	ctx := offeringChangeAdminContext(t)
	c.oldOffering.CountsAsCare, c.oldOffering.CountsAsCareSet = true, true
	require.NoError(t, newCareOfferingFixtureRecords(c.env.repos.CarePlan()).Update(ctx, c.oldOffering))
	row := c.submit(t)
	manual := repositoryActivityGroup(t, ctx, c.env, "ManualPlanningKeptEnd")
	manual.Type, manual.IsTemplate, manual.TargetGroupType = timetable.GroupTypeCare, true, timetable.TargetGroupTypeOffering
	require.NoError(t, timetableCompose.NativeGroupRecords(c.env.timetable.Timetable).Update(ctx, manual))
	period := testpkg.CreateTestCalendarPeriod(t, c.env.db, "Kept end "+t.Name(),
		calendar.Date(c.env.sourcePhase.ServiceStartDate), calendar.Date(c.env.sourcePhase.ServiceEndDate))
	room := testpkg.CreateTestRoom(t, c.env.db, "Kept end")
	tuesdayFrom := func(day calendar.Date) calendar.Date {
		for day.Weekday() != time.Tuesday {
			day = day.AddDays(1)
		}
		return day
	}
	before, after := tuesdayFrom(c.switchDate), tuesdayFrom(c.bookingEnd)
	materialized := planningOccurrenceOpts{materialized: true}
	createPlanningOccurrence(t, c.env, manual.ID, c.studentID, room.ID, period.ID, before, "Vor dem Ende", materialized)
	createPlanningOccurrence(t, c.env, manual.ID, c.studentID, room.ID, period.ID, after, "Nach dem Ende", materialized)

	preview, err := testpkg.TenantQuery3(t, ctx, testpkg.SetupTestDB(t), c.svc.PreviewDecision, row.ID, []int64(nil), (*calendar.Date)(nil))
	require.NoError(t, err)
	require.Len(t, preview.ManualPlanningConflicts, 1)
	assert.Equal(t, after, preview.ManualPlanningConflicts[0].FirstDate, "only the Tuesday after the end is uncovered")
	assert.Equal(t, 1, preview.ManualPlanningConflicts[0].OccurrenceCount)
}
