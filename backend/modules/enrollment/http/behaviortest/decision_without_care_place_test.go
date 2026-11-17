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
