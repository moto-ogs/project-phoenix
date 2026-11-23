package contracttest_test

import (
	"context"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/api"
	enrollmentTest "github.com/moto-ogs/project-phoenix/modules/enrollment/enrollmenttest"
	offeringContract "github.com/moto-ogs/project-phoenix/modules/enrollment/offeringcontract"
	"github.com/moto-ogs/project-phoenix/modules/timetable"
	timetableCompose "github.com/moto-ogs/project-phoenix/modules/timetable/compose"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// A child stays on a roster for as long as one of its bookings puts it
// there, whether the offering names the roster through the direct link
// (ActivityGroupID) or the roster names the offering as its source (#7908).

// directLinkBookingEnd is the exclusive end of the bookings these tests end
// before the phase: Monday 1 February 2027.
var directLinkBookingEnd = calendar.NewDate(2027, 2, 1)

// rosterSpan is what a roster row plans: its weekdays from a day to an
// exclusive end.
type rosterSpan struct {
	Weekdays    []int
	From, Until string
}

func rosterSpans(rows []timetable.StudentEnrollment) []rosterSpan {
	spans := make([]rosterSpan, 0, len(rows))
	for _, row := range rows {
		span := rosterSpan{Weekdays: row.SelectedWeekdays, From: row.ValidFrom}
		if row.ValidUntil != nil {
			span.Until = *row.ValidUntil
		}
		spans = append(spans, span)
	}
	return spans
}

func rosterSpansByID(rows []timetable.StudentEnrollment) map[int64]rosterSpan {
	byID := make(map[int64]rosterSpan, len(rows))
	for i, span := range rosterSpans(rows) {
		byID[rows[i].ID] = span
	}
	return byID
}

func directLinkPeriod(t *testing.T, env *decisionTestEnv) int64 {
	t.Helper()
	period := api.CreateCareOfferingCalendarPeriod(func(err error) { require.NoError(t, err) }, testpkg.NewDatabase(t, env.db), testpkg.Ctx(t),
		testpkg.Tenant(t), uniqueSchemaName(t.Name()), calendar.Date(env.sourcePhase.ServiceStartDate).AddDays(-31),
		calendar.Date(env.sourcePhase.ServiceEndDate).AddDays(31))
	return period.ID
}

// directLinkRoster is a template with a Monday and a Tuesday schedule.
func directLinkRoster(t *testing.T, env *decisionTestEnv, name string, periodID int64) *timetable.Group {
	t.Helper()
	roster := createCareOfferingTemplateGroup(t, env.db, name)
	createCareOfferingTemplateSchedule(t, env.db, roster.ID, timetable.WeekdayMonday, &periodID)
	createCareOfferingTemplateSchedule(t, env.db, roster.ID, timetable.WeekdayTuesday, &periodID)
	return roster
}

// directLinkOffering is an offering with fixed weekdays, linked to roster
// directly when one is given.
func directLinkOffering(t *testing.T, env *decisionTestEnv, name string, roster *int64, days ...string) *offeringContract.CareOfferingRecord {
	t.Helper()
	offering := createSourceOffering(t, env, name, roster)
	offering.AvailableDays, offering.PickupTimes = days, carePickupTimes(days...)
	require.NoError(t, newCareOfferingFixtureRecords(env.repos.CarePlan()).Update(testpkg.Ctx(t), offering))
	return offering
}

// approveDirectLinkChild submits a child with the offerings, ends the
// bookings named in ends on directLinkBookingEnd and approves the child.
func approveDirectLinkChild(t *testing.T, env *decisionTestEnv, firstName string, offeringIDs []int64, ends ...int64) (studentID, childID int64) {
	t.Helper()
	return approveDirectLinkChildIn(testpkg.Ctx(t), t, env, firstName, offeringIDs, ends...)
}

func approveDirectLinkChildIn(ctx context.Context, t *testing.T, env *decisionTestEnv, firstName string, offeringIDs []int64, ends ...int64) (studentID, childID int64) {
	t.Helper()
	grade := int16(2)
	submitted, err := testpkg.TenantQuery1(t, ctx, env.db, submitShown(env.requestSvc), enrollmentTest.SubmitRequest{
		TenantID: testpkg.Tenant(t), PhaseID: env.sourcePhase.ID,
		GuardianFirstName: "Eltern", GuardianLastName: "Liste", GuardianEmail: firstName + "-liste@example.com",
		ConsentFlags: enrollmentTest.FormValuesOf(map[string]any{"agb": true, "data_processing": true, "email_contact": true, "photo": true}),
		Children: []enrollmentTest.SubmitChild{{FirstName: firstName, LastName: "Liste", DateOfBirth: calendar.NewDate(2018, 4, 15),
			TargetGradeLevel: &grade, OfferingIDs: offeringIDs}},
	})
	require.NoError(t, err)
	require.Len(t, submitted.Children, 1)
	childID = submitted.Children[0].ID
	for _, offeringID := range ends {
		result, err := env.db.NewRaw(`UPDATE enrollment.care_offering_bookings SET valid_until = ?
			WHERE tenant_id = ? AND request_child_id = ? AND care_offering_id = ?`,
			directLinkBookingEnd, testpkg.Tenant(t), childID, offeringID).Exec(ctx)
		require.NoError(t, err)
		changed, err := result.RowsAffected()
		require.NoError(t, err)
		require.EqualValues(t, 1, changed, "the booking to end exists")
	}
	outcome, err := testpkg.TenantQuery1(t, ctx, env.db, env.decision.Decide, enrollmentTest.DecideInput{
		RequestID: submitted.Request.ID, ChildID: childID, Status: enrollmentTest.DecisionApproved, ReviewedBy: env.creatorID,
	})
	require.NoError(t, err)
	require.NotNil(t, outcome.Child.CreatedStudentID)
	return *outcome.Child.CreatedStudentID, childID
}

// A booking that ends before the phase ends the roster row of its directly
// linked offering, and the child leaves the occurrences after it.
func TestDecide_DirectLinkRowAndOccurrencesEndWithTheBooking(t *testing.T) {
	t.Parallel()
	env := setupDecisionTest(t)
	periodID := directLinkPeriod(t, env)
	roster := directLinkRoster(t, env, "DirektBefristet", periodID)
	offering := directLinkOffering(t, env, "DirektBefristet", &roster.ID, "mon")
	occurrence := func(date calendar.Date) int64 {
		return testpkg.CreateTestActivityInstance(t, env.db, date, *roster.PlannedRoomID, testpkg.ActivityInstanceOpts{
			ActivityGroupID: &roster.ID, CalendarPeriodID: &periodID}).ID
	}
	lastBooked, firstAfter := occurrence(directLinkBookingEnd.AddDays(-7)), occurrence(directLinkBookingEnd)

	studentID, _ := approveDirectLinkChild(t, env, "Bela", []int64{offering.ID}, offering.ID)

	start := string(calendar.Date(env.sourcePhase.ServiceStartDate))
	assert.Equal(t, []rosterSpan{{Weekdays: []int{1}, From: start, Until: string(directLinkBookingEnd)}},
		rosterSpans(loadTemplateEnrollments(t, env, roster.ID)), "the roster row ends with the booking")
	booked := loadSourcedInstanceStudents(t, env, lastBooked)
	require.Len(t, booked, 1, "the child is on the last occurrence of its booking")
	assert.Equal(t, studentID, booked[0].StudentID)
	assert.Empty(t, loadSourcedInstanceStudents(t, env, firstAfter), "the child is on no occurrence after its booking")
}

// Offering A names the roster through the direct link and ends in January;
// offering B is the only source of the same roster and runs to the end of
// the phase. The child books both and stays on the roster for B: Tuesday
// throughout, Monday from the day A ends. A later resync of the roster
// agrees with what the approval wrote.
func TestDecide_DirectLinkEndingEarlyKeepsTheChildOnTheRosterOfItsSource(t *testing.T) {
	t.Parallel()
	env := setupDecisionTest(t)
	ctx := testpkg.Ctx(t)
	periodID := directLinkPeriod(t, env)
	source := directLinkOffering(t, env, "QuelleBisJuli", nil, "mon", "tue")
	roster := createSourcedTemplate(t, env, "GemischteListe", source.ID, nil, periodID)
	createCareOfferingTemplateSchedule(t, env.db, roster.ID, timetable.WeekdayTuesday, &periodID)
	direct := directLinkOffering(t, env, "DirektBisJanuar", &roster.ID, "mon")

	_, childID := approveDirectLinkChild(t, env, "Mira", []int64{direct.ID, source.ID}, direct.ID)

	start, end := string(calendar.Date(env.sourcePhase.ServiceStartDate)), string(calendar.Date(env.sourcePhase.ServiceEndDate).AddDays(1))
	approved := loadTemplateEnrollments(t, env, roster.ID)
	require.Len(t, approved, 3)
	assert.ElementsMatch(t, []rosterSpan{
		{Weekdays: []int{1}, From: start, Until: string(directLinkBookingEnd)},
		{Weekdays: []int{2}, From: start, Until: string(directLinkBookingEnd)},
		{Weekdays: []int{1, 2}, From: string(directLinkBookingEnd), Until: end},
	}, rosterSpans(approved), "the source keeps the child on the roster to the end of its booking")

	require.NoError(t, offeringResyncer(t, env).ResyncTemplateOfferingRoster(ctx, timetable.OfferingRosterResyncInput{
		TemplateID: roster.ID, OfferingIDs: []int64{source.ID}, CalendarPeriodID: &periodID, EffectiveFrom: offeringResyncToday,
	}))
	resynced := loadTemplateEnrollments(t, env, roster.ID)
	assert.Equal(t, rosterSpansByID(approved), rosterSpansByID(resynced), "the resync leaves the rows of the approval as they are")

	// A dated change that keeps both offerings keeps the end of A (#7928):
	// the roster shows the same spans as after the approval. Tuesday and
	// Monday run with A to its end, then both with the source to the end of
	// the phase; the row that begins after the switch is written again.
	var requestID int64
	require.NoError(t, env.db.NewRaw(`SELECT request_id FROM enrollment.request_children WHERE tenant_id = ? AND id = ?`,
		testpkg.Tenant(t), childID).Scan(ctx, &requestID))
	switchDate := calendar.NewDate(2026, 11, 2)
	_, err := testpkg.TenantQuery1(t, ctx, env.db, env.decision.UpdateChildOfferings, enrollmentTest.UpdateChildOfferingsInput{
		RequestID: requestID, ChildID: childID, ActorAccountID: env.creatorID, ActorRole: "admin", Reason: "Wochentage bestätigt",
		EffectiveFrom: &switchDate,
		Offerings:     []enrollmentTest.OfferingAdjustmentSelection{{OfferingID: direct.ID}, {OfferingID: source.ID}},
	})
	require.NoError(t, err)
	assert.ElementsMatch(t, rosterSpans(approved), rosterSpans(loadTemplateEnrollments(t, env, roster.ID)),
		"A keeps its end, and the roster follows both bookings as before")
}

// Two offerings name one roster through the direct link. Bookings that end
// on different days end each weekday with its own booking. Bookings that
// both run to the end of the phase share one row over the whole phase, as
// before.
func TestDecide_DirectLinksOnOneRosterEndEachWeekdayWithItsBooking(t *testing.T) {
	t.Parallel()
	env := setupDecisionTest(t)
	periodID := directLinkPeriod(t, env)
	roster := directLinkRoster(t, env, "ZweiModule", periodID)
	monday := directLinkOffering(t, env, "ModulMontag", &roster.ID, "mon")
	tuesday := directLinkOffering(t, env, "ModulDienstag", &roster.ID, "tue")
	start, end := string(calendar.Date(env.sourcePhase.ServiceStartDate)), string(calendar.Date(env.sourcePhase.ServiceEndDate).AddDays(1))

	apart, _ := approveDirectLinkChild(t, env, "Arne", []int64{monday.ID, tuesday.ID}, monday.ID)
	together, _ := approveDirectLinkChild(t, env, "Tilda", []int64{monday.ID, tuesday.ID})

	byStudent := map[int64][]timetable.StudentEnrollment{}
	for _, row := range loadTemplateEnrollments(t, env, roster.ID) {
		byStudent[row.StudentID] = append(byStudent[row.StudentID], row)
	}
	assert.ElementsMatch(t, []rosterSpan{
		{Weekdays: []int{1, 2}, From: start, Until: string(directLinkBookingEnd)},
		{Weekdays: []int{2}, From: string(directLinkBookingEnd), Until: end},
	}, rosterSpans(byStudent[apart]), "Monday ends with its booking, Tuesday runs on")
	require.Len(t, byStudent[together], 1, "open-ended bookings keep their one row")
	assert.Equal(t, rosterSpan{Weekdays: []int{1, 2}, From: start, Until: end}, rosterSpans(byStudent[together])[0])
	require.NotNil(t, byStudent[together][0].CalendarPeriodID)
	assert.Equal(t, periodID, *byStudent[together][0].CalendarPeriodID)
}

// Two offerings name a roster through the direct link (Monday ends in
// January, Tuesday runs on); the roster also takes its children from two
// source offerings, one of which the child books on Tuesday. A dated change
// in March books another offering and keeps Tuesday. The Tuesday row that
// began when Monday ended stays and runs on: the union resync after the
// switch must not cap it because the new direct Tuesday booking only begins
// at the switch.
func TestUpdateChildOfferings_DatedChangeKeepsDirectRowBesideMultiSourceRoster(t *testing.T) {
	t.Parallel()
	env := setupDecisionTest(t)
	ctx := testpkg.Ctx(t)
	periodID := directLinkPeriod(t, env)
	firstSource := directLinkOffering(t, env, "MehrquelleEins", nil, "tue")
	secondSource := directLinkOffering(t, env, "MehrquelleZwei", nil, "tue")
	roster := createSourcedTemplate(t, env, "DirektUndMehrquellen", firstSource.ID, nil, periodID)
	roster.SourceCareOfferingIDs = []int64{firstSource.ID, secondSource.ID}
	require.NoError(t, timetableCompose.NativeGroupRecords(testTimetableRepositories(env.db).Timetable).Update(ctx, roster))
	createCareOfferingTemplateSchedule(t, env.db, roster.ID, timetable.WeekdayTuesday, &periodID)
	monday := directLinkOffering(t, env, "DirektMontag", &roster.ID, "mon")
	tuesday := directLinkOffering(t, env, "DirektDienstag", &roster.ID, "tue")
	other := directLinkOffering(t, env, "AnderesModul", nil, "wed")

	_, childID := approveDirectLinkChild(t, env, "Ole", []int64{monday.ID, tuesday.ID, firstSource.ID}, monday.ID)

	start, end := string(calendar.Date(env.sourcePhase.ServiceStartDate)), string(calendar.Date(env.sourcePhase.ServiceEndDate).AddDays(1))
	approved := loadTemplateEnrollments(t, env, roster.ID)
	require.ElementsMatch(t, []rosterSpan{
		{Weekdays: []int{1, 2}, From: start, Until: string(directLinkBookingEnd)},
		{Weekdays: []int{2}, From: string(directLinkBookingEnd), Until: end},
	}, rosterSpans(approved), "sanity: Monday ends with its booking, Tuesday runs on")

	var requestID int64
	require.NoError(t, env.db.NewRaw(`SELECT request_id FROM enrollment.request_children WHERE tenant_id = ? AND id = ?`,
		testpkg.Tenant(t), childID).Scan(ctx, &requestID))
	switchDate := calendar.NewDate(2027, 3, 1)
	_, err := testpkg.TenantQuery1(t, ctx, env.db, env.decision.UpdateChildOfferings, enrollmentTest.UpdateChildOfferingsInput{
		RequestID: requestID, ChildID: childID, ActorAccountID: env.creatorID, ActorRole: "admin", Reason: "Mittwoch dazu",
		EffectiveFrom: &switchDate,
		Offerings: []enrollmentTest.OfferingAdjustmentSelection{
			{OfferingID: tuesday.ID}, {OfferingID: firstSource.ID}, {OfferingID: other.ID},
		},
	})
	require.NoError(t, err)
	assert.Equal(t, rosterSpansByID(approved), rosterSpansByID(loadTemplateEnrollments(t, env, roster.ID)),
		"the kept Tuesday row runs on to the end of the phase")
}

// The Klassen filter of a roster's source applies on approval as it does in
// the resync: a child outside the filter gets no source row, neither beside
// the direct link of another offering nor on a roster that only names the
// source.
func TestDecide_SourceClassFilterAppliesOnApproval(t *testing.T) {
	t.Parallel()
	env := setupDecisionTest(t)
	ctx := testpkg.Ctx(t)
	periodID := directLinkPeriod(t, env)
	source := directLinkOffering(t, env, "QuelleNur2a", nil, "tue")
	classFiltered := func(name string) *timetable.Group {
		roster := createSourcedTemplate(t, env, name, source.ID, nil, periodID)
		roster.SourceSchoolClasses = []string{"2a"}
		require.NoError(t, timetableCompose.NativeGroupRecords(testTimetableRepositories(env.db).Timetable).Update(ctx, roster))
		createCareOfferingTemplateSchedule(t, env.db, roster.ID, timetable.WeekdayTuesday, &periodID)
		return roster
	}
	mixed, sourceOnly := classFiltered("KlasseGemischt"), classFiltered("KlasseNurQuelle")
	direct := directLinkOffering(t, env, "DirektMontagAlle", &mixed.ID, "mon")

	studentID, _ := approveDirectLinkChild(t, env, "Kai", []int64{direct.ID, source.ID})
	var class string
	require.NoError(t, env.db.NewRaw(`SELECT school_class FROM users.student_school_memberships
		WHERE student_profile_id = ? AND deleted_at IS NULL`, studentID).Scan(ctx, &class))
	require.NotEqual(t, "2a", class, "sanity: the child is outside the filter")

	start, end := string(calendar.Date(env.sourcePhase.ServiceStartDate)), string(calendar.Date(env.sourcePhase.ServiceEndDate).AddDays(1))
	assert.Equal(t, []rosterSpan{{Weekdays: []int{1}, From: start, Until: end}}, rosterSpans(loadTemplateEnrollments(t, env, mixed.ID)),
		"the direct link plans Monday, the filtered source plans no Tuesday")
	assert.Empty(t, loadTemplateEnrollments(t, env, sourceOnly.ID), "the filtered source plans nothing")
}

// The approval writes all roster rows of a child in one statement, however
// many rows its bookings cut (#7908).
func TestDecide_WritesTheRosterRowsOfAChildInOneStatement(t *testing.T) {
	t.Parallel()
	env := setupDecisionTest(t)
	periodID := directLinkPeriod(t, env)
	first, second := directLinkRoster(t, env, "ZeilenEins", periodID), directLinkRoster(t, env, "ZeilenZwei", periodID)
	offerings := []int64{}
	for _, roster := range []int64{first.ID, second.ID} {
		offerings = append(offerings, directLinkOffering(t, env, "Montag", &roster, "mon").ID, directLinkOffering(t, env, "Dienstag", &roster, "tue").ID)
	}
	counter := testpkg.CaptureQueriesForContext(t, env.db)

	approveDirectLinkChildIn(counter.Context(testpkg.Ctx(t)), t, env, "Zora", offerings, offerings[0], offerings[2])

	require.Len(t, loadTemplateEnrollments(t, env, first.ID), 2, "sanity: the bookings cut two rows per roster")
	require.Len(t, loadTemplateEnrollments(t, env, second.ID), 2)
	inserts := counter.Matching(func(sql string) bool {
		return strings.HasPrefix(sql, "insert into activities.student_enrollments") || strings.HasPrefix(sql, `insert into "activities"."student_enrollments"`)
	})
	assert.Len(t, inserts, 1, "one statement writes every roster row of the child")
}
