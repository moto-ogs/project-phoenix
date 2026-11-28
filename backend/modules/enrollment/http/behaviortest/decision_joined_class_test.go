package enrollmenthttp_test

import (
	"fmt"
	"testing"
	"time"

	peopleValues "github.com/moto-ogs/project-phoenix/modules/peopledirectory"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	capability "github.com/moto-ogs/project-phoenix/modules/enrollment"
	enrollmentAPI "github.com/moto-ogs/project-phoenix/modules/enrollment/http"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// TestDecisionService_ApprovedNewChildJoinsPlannedOccurrencesOfItsClass pins
// #8279: approving an enrollment creates the child with its class, and the
// child stands at once in the already planned occurrences of every
// Regeltermin with a matching Klasse or Jahrgang target, from its care start
// on. Past days, days before the care start, other classes and another
// school's Regeltermine stay as they are.
func TestDecisionService_ApprovedNewChildJoinsPlannedOccurrencesOfItsClass(t *testing.T) {
	t.Parallel()

	env := setupDecisionTest(t)
	ctx := testpkg.Ctx(t)
	occurrences := newJoinedClassOccurrences(t, env)

	// The submitted grade 2 becomes Klasse "2"; the care starts on
	// 1 September 2026, today is 24 August 2026.
	class2 := occurrences.template(t, "target_school_class", "2")
	grade2 := occurrences.template(t, "target_grade_level", 2)
	class3 := occurrences.template(t, "target_school_class", "3")
	past := occurrences.on(t, class2, calendar.NewDate(2026, 8, 21))
	beforeCare := occurrences.on(t, class2, calendar.NewDate(2026, 8, 25))
	firstWeek := occurrences.on(t, class2, calendar.NewDate(2026, 9, 1))
	gradeWeek := occurrences.on(t, grade2, calendar.NewDate(2026, 9, 2))
	otherClass := occurrences.on(t, class3, calendar.NewDate(2026, 9, 1))
	foreign := occurrences.foreignClassOccurrence(t, "2", calendar.NewDate(2026, 9, 1))

	requestID, childID := submitOneChild(t, env, "neue-klasse@example.com", "Nele", "Neu")
	_, err := testpkg.TenantQuery1(t, ctx, testpkg.SetupTestDB(t), env.decision.Decide, enrollmentAPI.DecideInput{
		RequestID: requestID, ChildID: childID, Status: capability.DecisionApproved, ReviewedBy: env.creatorID,
	})
	require.NoError(t, err)
	child, err := ReadOwnerChildForTest(ctx, env.repos.Enrollment(), childID)
	require.NoError(t, err)
	require.NotNil(t, child.CreatedStudentID)
	studentID := *child.CreatedStudentID

	assert.Equal(t, []int64{studentID}, classSwitchRoster(t, env, firstWeek), "the new child joins the planned Klasse 2 occurrence")
	assert.Equal(t, []int64{studentID}, classSwitchRoster(t, env, gradeWeek), "the Jahrgang target follows the new child too")
	assert.Empty(t, classSwitchRoster(t, env, past), "a past occurrence stays as it was")
	assert.Empty(t, classSwitchRoster(t, env, beforeCare), "no occurrence before the care start")
	assert.Empty(t, classSwitchRoster(t, env, otherClass), "another class stays without the child")
	assert.Empty(t, classSwitchRoster(t, env, foreign), "another school's Klasse 2 occurrence stays untouched")

	// A care start before today joins from today on.
	env.sourcePhase.ServiceStartDate = capability.Date(calendar.NewDate(2026, 8, 1))
	require.NoError(t, testpkg.TenantCommand1(t, ctx, env.db, env.repos.Enrollment().UpdatePhase, OwnerPhaseForTest(env.sourcePhase)))
	today := occurrences.on(t, class2, decisionTestToday)
	requestID, childID = submitOneChild(t, env, "neue-klasse-heute@example.com", "Hanna", "Heute")
	_, err = testpkg.TenantQuery1(t, ctx, testpkg.SetupTestDB(t), env.decision.Decide, enrollmentAPI.DecideInput{
		RequestID: requestID, ChildID: childID, Status: capability.DecisionApproved, ReviewedBy: env.creatorID,
	})
	require.NoError(t, err)
	child, err = ReadOwnerChildForTest(ctx, env.repos.Enrollment(), childID)
	require.NoError(t, err)
	require.NotNil(t, child.CreatedStudentID)
	assert.Equal(t, []int64{*child.CreatedStudentID}, classSwitchRoster(t, env, today), "a running care joins from today")
	assert.Equal(t, []int64{*child.CreatedStudentID}, classSwitchRoster(t, env, beforeCare))
	assert.Empty(t, classSwitchRoster(t, env, past), "a past occurrence stays as it was")
}

// TestDecisionService_ChildWithoutCarePlaceJoinsItsClassWithThePlace pins
// #8279 for a child of the converted class list (#4803): without an OGS
// place it stands in no Regeltermin (ADR 0282). The approval that gives it
// its place, at once or with the class switch on the first day of the new
// school year, lets it join the planned occurrences of its class from then
// on, although its class stays.
func TestDecisionService_ChildWithoutCarePlaceJoinsItsClassWithThePlace(t *testing.T) {
	t.Parallel()

	env := setupDecisionTest(t)
	ctx := testpkg.Ctx(t)
	occurrences := newJoinedClassOccurrences(t, env)
	class2a := occurrences.template(t, "target_school_class", "2a")
	past := occurrences.on(t, class2a, calendar.NewDate(2026, 8, 21))
	today := occurrences.on(t, class2a, decisionTestToday)
	next := occurrences.on(t, class2a, calendar.NewDate(2026, 8, 25))
	newYear := occurrences.on(t, class2a, calendar.NewDate(2030, 8, 1))

	approve := func(first, last, email string, studentID int64) {
		t.Helper()
		requestID, childID := submitReEnrollment(t, env, "Eltern", last, email, nil,
			first, last, map[string]any{"agb": true, "data_processing": true, "email_contact": true, "photo": true})
		matchChildToExistingStudent(t, env, childID, studentID)
		_, err := testpkg.TenantQuery1(t, ctx, testpkg.SetupTestDB(t), env.decision.Decide, enrollmentAPI.DecideInput{
			RequestID: requestID, ChildID: childID, Status: capability.DecisionApproved, ReviewedBy: env.creatorID,
		})
		require.NoError(t, err)
	}

	// A running school year: the approval grants the place at once.
	env.sourcePhase.ServiceStartDate = capability.Date(calendar.NewDate(2026, 8, 1))
	require.NoError(t, testpkg.TenantCommand1(t, ctx, env.db, env.repos.Enrollment().UpdatePhase, OwnerPhaseForTest(env.sourcePhase)))
	now := testpkg.CreateTestStudent(t, env.db, "Ida", "Sofort", "2a")
	testpkg.MarkTestStudentWithoutCarePlace(t, env.db, now.ID)
	approve("Ida", "Sofort", "platz-sofort@example.com", now.ID)

	assert.Equal(t, []int64{now.ID}, classSwitchRoster(t, env, today), "with its place the child joins today's 2a occurrence")
	assert.Equal(t, []int64{now.ID}, classSwitchRoster(t, env, next), "and the later ones")
	assert.Empty(t, classSwitchRoster(t, env, past), "a past occurrence stays as it was")

	// The next school year: the place waits for the class switch.
	env.sourcePhase.ServiceStartDate = capability.Date(calendar.NewDate(2030, 8, 1))
	env.sourcePhase.ServiceEndDate = capability.Date(calendar.NewDate(2031, 7, 31))
	require.NoError(t, testpkg.TenantCommand1(t, ctx, env.db, env.repos.Enrollment().UpdatePhase, OwnerPhaseForTest(env.sourcePhase)))
	later := testpkg.CreateTestStudent(t, env.db, "Ole", "Spaeter", "2a")
	testpkg.MarkTestStudentWithoutCarePlace(t, env.db, later.ID)
	approve("Ole", "Spaeter", "platz-spaeter@example.com", later.ID)
	assert.Equal(t, []int64{now.ID}, classSwitchRoster(t, env, newYear), "without its place the child stands in no Regeltermin yet")

	_, err := testpkg.TenantQuery1(t, ctx, testpkg.SetupTestDB(t), decisionOwner(t, env.decision).ApplyDueClassSwitches, calendar.NewDate(2030, 8, 1))
	require.NoError(t, err)
	assert.ElementsMatch(t, []int64{now.ID, later.ID}, classSwitchRoster(t, env, newYear), "the class switch grants the place and the child joins")
	assert.Equal(t, []int64{now.ID}, classSwitchRoster(t, env, next), "no day before the switch")
}

// TestDecisionService_InactiveExistingStudentRenewalJoinsClassFromFutureCareStart
// pins #8279 for a class-changing renewal of a child who is not currently in
// care: although the class is written at approval, the child may join targeted
// Regeltermine only from the renewal's future care start.
func TestDecisionService_InactiveExistingStudentRenewalJoinsClassFromFutureCareStart(t *testing.T) {
	t.Parallel()

	env := setupDecisionTest(t)
	ctx := testpkg.Ctx(t)
	futureStart := calendar.NewDate(2030, 8, 1)
	env.sourcePhase.Kind = capability.PhaseKindSchoolYear
	env.sourcePhase.ServiceStartDate = capability.Date(futureStart)
	env.sourcePhase.ServiceEndDate = capability.Date(calendar.NewDate(2031, 7, 31))
	require.NoError(t, testpkg.TenantCommand1(t, ctx, env.db, env.repos.Enrollment().UpdatePhase, OwnerPhaseForTest(env.sourcePhase)))

	occurrences := newJoinedClassOccurrences(t, env)
	class2 := occurrences.template(t, "target_school_class", "2")
	beforeCare := occurrences.on(t, class2, decisionTestToday.AddDays(1))
	fromCareStart := occurrences.on(t, class2, futureStart)

	existing := testpkg.CreateTestStudent(t, env.db, "Ole", "Pause", "1a")
	student, err := testpkg.TenantQuery1(t, ctx, testpkg.SetupTestDB(t), env.repos.Student.FindByID, any(existing.ID))
	require.NoError(t, err)
	student.Status = peopleValues.StudentStatusInactive
	require.NoError(t, testpkg.TenantCommand1(t, ctx, env.db, env.repos.Student.Update, student))

	requestID, childID := submitReEnrollment(t, env, "Eltern", "Pause", "renewal-future-class@example.com", nil,
		"Ole", "Pause", map[string]any{"agb": true, "data_processing": true, "email_contact": true, "photo": true})
	matchChildToExistingStudent(t, env, childID, existing.ID)

	_, err = testpkg.TenantQuery1(t, ctx, testpkg.SetupTestDB(t), env.decision.Decide, enrollmentAPI.DecideInput{
		RequestID: requestID, ChildID: childID, Status: capability.DecisionApproved, ReviewedBy: env.creatorID,
	})
	require.NoError(t, err)

	assert.Empty(t, classSwitchRoster(t, env, beforeCare), "the child must not join before care starts")
	assert.Equal(t, []int64{existing.ID}, classSwitchRoster(t, env, fromCareStart), "the child joins when care starts")
}

// joinedClassOccurrences builds Regeltermine with a Klasse or Jahrgang target
// and their planned occurrences in one calendar period.
type joinedClassOccurrences struct {
	env      *decisionTestEnv
	periodID int64
	roomID   int64
}

func newJoinedClassOccurrences(t *testing.T, env *decisionTestEnv) *joinedClassOccurrences {
	t.Helper()
	period := testpkg.CreateTestCalendarPeriod(t, env.db, "Schuljahre Neue Kinder", calendar.NewDate(2026, 8, 1), calendar.NewDate(2031, 7, 31))
	return &joinedClassOccurrences{env: env, periodID: period.ID, roomID: testpkg.CreateTestRoom(t, env.db, "Neue Kinder").ID}
}

func (o *joinedClassOccurrences) template(t *testing.T, column string, value any) int64 {
	t.Helper()
	ctx := testpkg.Ctx(t)
	template := testpkg.CreateTestActivityGroup(t, o.env.db, fmt.Sprintf("Neue Kinder %s %v-%d", column, value, time.Now().UnixNano()))
	_, err := o.env.db.NewUpdate().TableExpr("activities.groups").Set("is_template = true").Set("calendar_period_id = ?", o.periodID).
		Where("id = ?", template.ID).Exec(ctx)
	require.NoError(t, err)
	targetType := map[string]string{"target_school_class": "klasse", "target_grade_level": "jahrgang"}[column]
	_, err = o.env.db.NewRaw(fmt.Sprintf(`INSERT INTO activities.group_targets (tenant_id, activity_group_id, target_group_type, %s)
		VALUES (?, ?, ?, ?)`, column), testpkg.Tenant(t), template.ID, targetType, value).Exec(ctx)
	require.NoError(t, err)
	return template.ID
}

func (o *joinedClassOccurrences) on(t *testing.T, templateID int64, day calendar.Date) int64 {
	t.Helper()
	return testpkg.CreateTestActivityInstance(t, o.env.db, day, o.roomID, testpkg.ActivityInstanceOpts{
		ActivityGroupID: &templateID, CalendarPeriodID: &o.periodID,
	}).ID
}

// foreignClassOccurrence plans a Klasse Regeltermin of another school.
func (o *joinedClassOccurrences) foreignClassOccurrence(t *testing.T, class string, day calendar.Date) int64 {
	t.Helper()
	ctx := testpkg.Ctx(t)
	db := o.env.db
	tenantID, _ := testpkg.CreateTestTenant(t, db)
	template := testpkg.CreateTestActivityGroupForTenant(t, db, tenantID, fmt.Sprintf("Fremde Klasse %s-%d", class, time.Now().UnixNano()))
	_, err := db.NewUpdate().TableExpr("activities.groups").Set("is_template = true").Where("id = ?", template.ID).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewRaw(`INSERT INTO activities.group_targets (tenant_id, activity_group_id, target_group_type, target_school_class)
		VALUES (?, ?, 'klasse', ?)`, tenantID, template.ID, class).Exec(ctx)
	require.NoError(t, err)
	room := testpkg.CreateTestRoomForTenant(t, db, tenantID, "Fremd")
	return testpkg.CreateTestActivityInstanceForTenant(t, db, tenantID, day, room.ID,
		testpkg.ActivityInstanceOpts{ActivityGroupID: &template.ID}).ID
}
