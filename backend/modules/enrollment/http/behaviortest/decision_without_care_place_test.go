package enrollmenthttp_test

import (
	"testing"

	capability "github.com/moto-ogs/project-phoenix/modules/enrollment"
	enrollmentAPI "github.com/moto-ogs/project-phoenix/modules/enrollment/http"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestDecisionService_DeferredRenewalKeepsChildWithoutCarePlaceUntilYearStarts
// gives a child without an OGS place (#4803 review) its place only when the
// accepted enrollment for the next school year starts: until the planned
// class switch it counts and lists nowhere in the OGS.
func TestDecisionService_DeferredRenewalKeepsChildWithoutCarePlaceUntilYearStarts(t *testing.T) {
	t.Parallel()

	env := setupDecisionTest(t)
	ctx := testpkg.Ctx(t)

	newYearStart := calendar.NewDate(2030, 8, 1)
	env.sourcePhase.Kind = capability.PhaseKindSchoolYear
	env.sourcePhase.ServiceStartDate = capability.Date(newYearStart)
	env.sourcePhase.ServiceEndDate = capability.Date(calendar.NewDate(2031, 7, 31))
	require.NoError(t, testpkg.TenantCommand1(t, ctx, env.db, env.repos.Enrollment().UpdatePhase, OwnerPhaseForTest(env.sourcePhase)))

	child := testpkg.CreateTestStudent(t, env.db, "Ole", "Ohneplatz", "1a")
	testpkg.MarkTestStudentWithoutCarePlace(t, env.db, child.ID)
	withoutPlace := func() bool {
		var mark bool
		require.NoError(t, env.db.NewRaw(`SELECT without_care_place FROM users.student_school_memberships
			WHERE tenant_id = ? AND student_profile_id = ? AND deleted_at IS NULL`, testpkg.Tenant(t), child.ID).Scan(ctx, &mark))
		return mark
	}

	requestID, childID := submitReEnrollment(t, env, "Eltern", "Ohneplatz", "renewal-without-place@example.com", nil,
		"Ole", "Ohneplatz", map[string]any{"agb": true, "data_processing": true, "email_contact": true, "photo": true})
	matchChildToExistingStudent(t, env, childID, child.ID)
	_, err := testpkg.TenantQuery1(t, ctx, testpkg.SetupTestDB(t), env.decision.Decide, enrollmentAPI.DecideInput{
		RequestID: requestID, ChildID: childID, Status: capability.DecisionApproved, ReviewedBy: env.creatorID,
	})
	require.NoError(t, err)
	assert.True(t, withoutPlace(), "the place waits for the new school year")

	applied, err := testpkg.TenantQuery1(t, ctx, testpkg.SetupTestDB(t), decisionOwner(t, env.decision).ApplyDueClassSwitches, newYearStart)
	require.NoError(t, err)
	assert.Equal(t, 1, applied)
	assert.False(t, withoutPlace(), "the class switch on the first day grants the place")
}

// TestDecisionService_SkippedClassSwitchStillGrantsThePlace grants the
// deferred place on the first day even when the school changed the child's
// class after the approval, which skips the class switch (#4803 review).
func TestDecisionService_SkippedClassSwitchStillGrantsThePlace(t *testing.T) {
	t.Parallel()

	env := setupDecisionTest(t)
	ctx := testpkg.Ctx(t)

	newYearStart := calendar.NewDate(2030, 8, 1)
	env.sourcePhase.Kind = capability.PhaseKindSchoolYear
	env.sourcePhase.ServiceStartDate = capability.Date(newYearStart)
	env.sourcePhase.ServiceEndDate = capability.Date(calendar.NewDate(2031, 7, 31))
	require.NoError(t, testpkg.TenantCommand1(t, ctx, env.db, env.repos.Enrollment().UpdatePhase, OwnerPhaseForTest(env.sourcePhase)))

	child := testpkg.CreateTestStudent(t, env.db, "Mia", "Umgesetzt", "1a")
	testpkg.MarkTestStudentWithoutCarePlace(t, env.db, child.ID)
	membership := func() (bool, string) {
		var mark bool
		var class string
		require.NoError(t, env.db.NewRaw(`SELECT without_care_place, school_class FROM users.student_school_memberships
			WHERE tenant_id = ? AND student_profile_id = ? AND deleted_at IS NULL`, testpkg.Tenant(t), child.ID).Scan(ctx, &mark, &class))
		return mark, class
	}

	requestID, childID := submitReEnrollment(t, env, "Eltern", "Umgesetzt", "renewal-moved@example.com", nil,
		"Mia", "Umgesetzt", map[string]any{"agb": true, "data_processing": true, "email_contact": true, "photo": true})
	matchChildToExistingStudent(t, env, childID, child.ID)
	_, err := testpkg.TenantQuery1(t, ctx, testpkg.SetupTestDB(t), env.decision.Decide, enrollmentAPI.DecideInput{
		RequestID: requestID, ChildID: childID, Status: capability.DecisionApproved, ReviewedBy: env.creatorID,
	})
	require.NoError(t, err)
	_, err = env.db.ExecContext(ctx, `UPDATE users.student_school_memberships SET school_class = '1b'
		WHERE tenant_id = ? AND student_profile_id = ? AND deleted_at IS NULL`, testpkg.Tenant(t), child.ID)
	require.NoError(t, err)

	_, err = testpkg.TenantQuery1(t, ctx, testpkg.SetupTestDB(t), decisionOwner(t, env.decision).ApplyDueClassSwitches, newYearStart)
	require.NoError(t, err)
	mark, class := membership()
	assert.False(t, mark, "the skipped class switch still grants the place")
	assert.Equal(t, "1b", class, "the school's class stays")
}

// TestDecisionService_SkippedClassSwitchResyncsOfferingRosterWhenGrantingPlace
// pins #8279 for a child whose school class changed before its deferred place
// is granted: the place makes its offering-sourced planned roster follow too.
func TestDecisionService_SkippedClassSwitchResyncsOfferingRosterWhenGrantingPlace(t *testing.T) {
	t.Parallel()

	env := setupDecisionTest(t)
	ctx := testpkg.Ctx(t)

	newYearStart := calendar.NewDate(2030, 8, 1)
	env.sourcePhase.Kind = capability.PhaseKindSchoolYear
	env.sourcePhase.ServiceStartDate = capability.Date(newYearStart)
	env.sourcePhase.ServiceEndDate = capability.Date(calendar.NewDate(2031, 7, 31))
	require.NoError(t, testpkg.TenantCommand1(t, ctx, env.db, env.repos.Enrollment().UpdatePhase, OwnerPhaseForTest(env.sourcePhase)))

	offering := createSourceOffering(t, env, "Aufgeschobener Platz", nil)
	period := offeringSourcePeriod(t, env)
	template := createSourcedTemplate(t, env, "Aufgeschobener Platz", offering.ID, nil, period)
	template.SourceSchoolClasses = []string{"1b"}
	_, err := env.db.NewUpdate().Model(template).Column("source_school_classes").WherePK().Exec(ctx)
	require.NoError(t, err)
	occurrence := testpkg.CreateTestActivityInstance(t, env.db, calendar.NewDate(2030, 8, 5), *template.PlannedRoomID,
		testpkg.ActivityInstanceOpts{ActivityGroupID: &template.ID, CalendarPeriodID: &period.ID})

	child := testpkg.CreateTestStudent(t, env.db, "Nele", "Angebot", "1a")
	testpkg.MarkTestStudentWithoutCarePlace(t, env.db, child.ID)
	requestID, childID := submitReEnrollment(t, env, "Eltern", "Angebot", "renewal-offering-roster@example.com", nil,
		"Nele", "Angebot", map[string]any{"agb": true, "data_processing": true, "email_contact": true, "photo": true})
	createChildOfferingLink(t, env, childID, offering.ID, nil, nil)
	matchChildToExistingStudent(t, env, childID, child.ID)
	_, err = testpkg.TenantQuery1(t, ctx, testpkg.SetupTestDB(t), env.decision.Decide, enrollmentAPI.DecideInput{
		RequestID: requestID, ChildID: childID, Status: capability.DecisionApproved, ReviewedBy: env.creatorID,
	})
	require.NoError(t, err)
	_, err = env.db.ExecContext(ctx, `UPDATE users.student_school_memberships SET school_class = '1b'
		WHERE tenant_id = ? AND student_profile_id = ? AND deleted_at IS NULL`, testpkg.Tenant(t), child.ID)
	require.NoError(t, err)
	assert.Empty(t, classSwitchRoster(t, env, occurrence.ID), "without its place the child is absent")

	applied, err := testpkg.TenantQuery1(t, ctx, testpkg.SetupTestDB(t), decisionOwner(t, env.decision).ApplyDueClassSwitches, newYearStart)
	require.NoError(t, err)
	assert.Zero(t, applied, "the school class changed before the deferred switch")
	assert.Equal(t, []int64{child.ID}, classSwitchRoster(t, env, occurrence.ID), "the granted place refreshes the offering-sourced roster")
}

// TestDecisionService_FullChildQuotaHoldsOnlyThePlace keeps the rollover
// running when the Kinderkontingent is full on the first day of the school
// year (#4803 review): the child without an OGS place moves into its new
// class all the same, only its place waits, and a later run grants it once
// one is free.
func TestDecisionService_FullChildQuotaHoldsOnlyThePlace(t *testing.T) {
	t.Parallel()

	env := setupDecisionTest(t)
	ctx := testpkg.Ctx(t)

	newYearStart := calendar.NewDate(2030, 8, 1)
	env.sourcePhase.Kind = capability.PhaseKindSchoolYear
	env.sourcePhase.ServiceStartDate = capability.Date(newYearStart)
	env.sourcePhase.ServiceEndDate = capability.Date(calendar.NewDate(2031, 7, 31))
	require.NoError(t, testpkg.TenantCommand1(t, ctx, env.db, env.repos.Enrollment().UpdatePhase, OwnerPhaseForTest(env.sourcePhase)))

	testpkg.CreateTestStudent(t, env.db, "Paul", "Platz", "1a")
	child := testpkg.CreateTestStudent(t, env.db, "Lea", "Wartend", "1a")
	testpkg.MarkTestStudentWithoutCarePlace(t, env.db, child.ID)
	membership := func() (bool, string) {
		var mark bool
		var class string
		require.NoError(t, env.db.NewRaw(`SELECT without_care_place, school_class FROM users.student_school_memberships
			WHERE tenant_id = ? AND student_profile_id = ? AND deleted_at IS NULL`, testpkg.Tenant(t), child.ID).Scan(ctx, &mark, &class))
		return mark, class
	}

	requestID, childID := submitReEnrollment(t, env, "Eltern", "Wartend", "renewal-quota@example.com", nil,
		"Lea", "Wartend", map[string]any{"agb": true, "data_processing": true, "email_contact": true, "photo": true})
	matchChildToExistingStudent(t, env, childID, child.ID)
	_, err := testpkg.TenantQuery1(t, ctx, testpkg.SetupTestDB(t), env.decision.Decide, enrollmentAPI.DecideInput{
		RequestID: requestID, ChildID: childID, Status: capability.DecisionApproved, ReviewedBy: env.creatorID,
	})
	require.NoError(t, err)

	var occupied int
	require.NoError(t, env.db.NewRaw(`SELECT COUNT(*) FROM users.student_school_memberships
		WHERE tenant_id = ? AND deleted_at IS NULL AND NOT without_care_place
		  AND (status = 'active' OR (status = 'pending' AND enrolled_from > CURRENT_DATE))
		  AND (enrolled_until IS NULL OR enrolled_until >= CURRENT_DATE)`, testpkg.Tenant(t)).Scan(ctx, &occupied))
	require.Positive(t, occupied)
	testpkg.SetTestChildQuota(t, env.db, occupied, 1)

	applied, err := testpkg.TenantQuery1(t, ctx, testpkg.SetupTestDB(t), decisionOwner(t, env.decision).ApplyDueClassSwitches, newYearStart)
	require.NoError(t, err, "a full Kinderkontingent must not stop the run")
	assert.Equal(t, 1, applied, "the class switch applies")
	mark, class := membership()
	assert.True(t, mark, "no place while the Kinderkontingent is full")
	assert.NotEqual(t, "1a", class, "the child is in its new class")

	// A confirmed edit of the approved child's class on a day the held plan
	// is due keeps the plan that still owes the place (#4803 review).
	_, err = env.db.ExecContext(ctx, `UPDATE enrollment.request_children SET class_switch_on = ?
		WHERE tenant_id = ? AND id = ?`, decisionTestToday, testpkg.Tenant(t), childID)
	require.NoError(t, err)
	approved, err := ReadOwnerChildForTest(ctx, env.repos.Enrollment(), childID)
	require.NoError(t, err)
	grade := int16(3)
	approved.TargetGradeLevel = &grade
	require.NoError(t, UpdateOwnerChildForTest(ctx, env.repos.Enrollment(), approved))
	_, err = changeRequestApplierForTest(t, env).SyncApprovedChildData(ctx, SyncApprovedChildDataInput{
		RequestID: requestID, ChildID: childID, ActorAccountID: env.creatorID,
	})
	require.NoError(t, err)
	mark, edited := membership()
	assert.True(t, mark, "the edit gives no place")
	assert.Equal(t, class, edited, "the tick, not the edit, writes the class")

	testpkg.SetTestChildQuota(t, env.db, occupied+1, 1)
	applied, err = testpkg.TenantQuery1(t, ctx, testpkg.SetupTestDB(t), decisionOwner(t, env.decision).ApplyDueClassSwitches, newYearStart)
	require.NoError(t, err)
	assert.Equal(t, 1, applied, "the held place is granted once one is free")
	mark, after := membership()
	assert.False(t, mark)
	assert.Equal(t, "3", after, "the class follows the confirmed edit")
}

// TestDecisionService_HolidayApprovalRefusesAChildWithoutCarePlace keeps a
// child without an OGS place in its class (#4803 review): a holiday phase
// would give it the place and end its care with the holidays, so the
// approval is refused and the child keeps its mark.
func TestDecisionService_HolidayApprovalRefusesAChildWithoutCarePlace(t *testing.T) {
	t.Parallel()

	env := setupDecisionTest(t)
	ctx := testpkg.Ctx(t)

	env.sourcePhase.Kind = capability.PhaseKindHoliday
	env.sourcePhase.ServiceStartDate = capability.Date(calendar.NewDate(2030, 10, 14))
	env.sourcePhase.ServiceEndDate = capability.Date(calendar.NewDate(2030, 10, 25))
	require.NoError(t, testpkg.TenantCommand1(t, ctx, env.db, env.repos.Enrollment().UpdatePhase, OwnerPhaseForTest(env.sourcePhase)))

	child := testpkg.CreateTestStudent(t, env.db, "Nele", "Ferien", "2b")
	testpkg.MarkTestStudentWithoutCarePlace(t, env.db, child.ID)

	requestID, childID := submitReEnrollment(t, env, "Eltern", "Ferien", "holiday-without-place@example.com", nil,
		"Nele", "Ferien", map[string]any{"agb": true, "data_processing": true, "email_contact": true, "photo": true})
	matchChildToExistingStudent(t, env, childID, child.ID)
	_, err := testpkg.TenantQuery1(t, ctx, testpkg.SetupTestDB(t), env.decision.Decide, enrollmentAPI.DecideInput{
		RequestID: requestID, ChildID: childID, Status: capability.DecisionApproved, ReviewedBy: env.creatorID,
	})
	require.ErrorIs(t, err, capability.ErrWithoutCarePlaceNeedsSchoolYear)

	var mark bool
	require.NoError(t, env.db.NewRaw(`SELECT without_care_place FROM users.student_school_memberships
		WHERE tenant_id = ? AND student_profile_id = ? AND deleted_at IS NULL`, testpkg.Tenant(t), child.ID).Scan(ctx, &mark))
	assert.True(t, mark, "the child keeps its mark")
}
