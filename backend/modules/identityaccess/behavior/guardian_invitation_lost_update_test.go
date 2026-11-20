package behavior_test

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/identityaccess"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Guardian invitation transitions read the row without a lock. A transition
// that commits between that read and the write must not be overwritten.

// A staff approval racing a rejection: the rejection committed first, so the
// approval must fail and leave no child link behind.
func TestApproveInvitation_LosesToConcurrentRejection(t *testing.T) {
	t.Parallel()
	env := setupGuardianInvitationTest(t)
	student := testpkg.CreateTestStudent(t, env.db, "Race", "Approval", "3c")
	creatorID := env.inviterAccountID(t)
	ctx := testpkg.Ctx(t)
	result, err := env.service.InviteToStudent(ctx, identityaccess.InviteToStudentRequest{
		StudentID: student.ID, Email: fmt.Sprintf("race-approval-%d@example.test", time.Now().UnixNano()),
		FirstName: "Race", LastName: "Guardian", CreatedBy: creatorID,
		RequestedByParentAccountID: &creatorID, RequireApproval: true,
	})
	require.NoError(t, err)
	require.NotNil(t, result.InvitationID)
	invitationID := *result.InvitationID

	err = raceHeldTransition(t, env.db, func(context.Context) error {
		return env.service.ApproveInvitation(ctx, invitationID, creatorID)
	}, `UPDATE auth.guardian_invitations SET approval_status = 'rejected', approved_by = ?, approved_at = NOW() WHERE id = ?`,
		creatorID, invitationID)

	require.Error(t, err, "the approval must not overwrite the committed rejection")
	var status string
	require.NoError(t, env.db.NewRaw(`SELECT approval_status FROM auth.guardian_invitations WHERE id = ?`, invitationID).
		Scan(context.Background(), &status))
	assert.Equal(t, "rejected", status)
	assert.False(t, env.linkExists(t, student.ID, result.GuardianProfileID), "a rejected request grants no child access")
}
