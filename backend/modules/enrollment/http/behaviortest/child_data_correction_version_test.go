package enrollmenthttp_test

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"

	enrollmentNative "github.com/moto-ogs/project-phoenix/modules/enrollment"
	enrollmentAPI "github.com/moto-ogs/project-phoenix/modules/enrollment/http"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/readstate"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// Two staff members correct the same approved child from one read (ADR
// 0311): the first correction is stored, the second carries the version it
// read and is refused, so it does not write the old surname back.
func TestCorrectApprovedChildData_RefusesACorrectionOfAnOlderRead(t *testing.T) {
	t.Parallel()
	env := setupDecisionTest(t)
	ctx := testpkg.Ctx(t)
	grade := int16(1)
	submission := validSubmission(t, env.sourcePhase.ID)
	submission.Children[0].TargetGradeLevel = &grade
	result, err := env.requestSvc.Submit(ctx, submission)
	require.NoError(t, err)
	requestID, childID := result.Request.ID, result.Children[0].ID
	_, err = testpkg.TenantQuery1(t, ctx, testpkg.SetupTestDB(t), env.decision.Decide, enrollmentAPI.DecideInput{
		RequestID: requestID, ChildID: childID, Status: enrollmentNative.DecisionApproved, ReviewedBy: env.creatorID,
	})
	require.NoError(t, err)
	read, err := ReadOwnerChildForTest(ctx, env.repos.Enrollment(), childID)
	require.NoError(t, err)
	shown := enrollmentNative.ChildDataVersion(read)

	svc := newChangeRequestServiceWithDecisionForTest(t, env)
	correct := func(lastName string, birthday calendar.Date) error {
		return testpkg.WithTenantTx(t, ctx, env.db, testpkg.Tenant(t), func(txCtx context.Context, _ bun.Tx) error {
			_, correctionErr := svc.CorrectApprovedChildData(txCtx, enrollmentAPI.CorrectApprovedChildDataInput{
				RequestID: requestID, ChildID: childID, FirstName: read.FirstName, LastName: lastName,
				DateOfBirth: birthday, TargetGradeLevel: read.TargetGradeLevel,
				Reason: "Angaben berichtigt", ActorAccountID: env.creatorID, ExpectedVersion: shown,
			})
			return correctionErr
		})
	}
	require.NoError(t, correct("Richtig", calendar.Date(read.DateOfBirth)))

	err = correct(read.LastName, calendar.NewDate(2018, 5, 16))
	require.ErrorIs(t, err, readstate.ErrChanged)
	stored, err := ReadOwnerChildForTest(ctx, env.repos.Enrollment(), childID)
	require.NoError(t, err)
	assert.Equal(t, "Richtig", stored.LastName)
	assert.Equal(t, read.DateOfBirth, stored.DateOfBirth)
}
