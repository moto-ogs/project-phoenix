package behavior_test

import (
	"fmt"
	"testing"

	"github.com/moto-ogs/project-phoenix/modules/identityaccess"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestGuardianInvitationIssuancePreservesUnrelatedApproval(t *testing.T) {
	t.Parallel()
	env := setupGuardianInvitationTest(t)
	for _, kind := range []string{"child invitation", "profile invitation"} {
		t.Run(kind, func(t *testing.T) {
			ctx := testpkg.OwnCtx(t)
			creator := env.inviterAccountID(t)
			child := testpkg.CreateTestStudent(t, env.db, "Pending", "Access", "1a")
			email := fmt.Sprintf("pending-access-%d@example.test", child.ID)
			pending, err := env.service.InviteToStudent(ctx, identityaccess.InviteToStudentRequest{
				StudentID: child.ID, Email: email, CreatedBy: creator,
				RequestedByParentAccountID: &creator, RequireApproval: true,
			})
			require.NoError(t, err)
			require.NotNil(t, pending.InvitationID)
			before := testpkg.GuardianInvitationByID(t, env.db, *pending.InvitationID)
			if kind == "child invitation" {
				sibling := testpkg.CreateTestStudent(t, env.db, "Direct", "Access", "1b")
				_, err = env.service.InviteToStudent(ctx, identityaccess.InviteToStudentRequest{
					StudentID: sibling.ID, Email: email, CreatedBy: creator,
				})
			} else {
				_, err = env.service.CreateGuardianInvitation(ctx, identityaccess.GuardianInvitationRequest{
					GuardianProfileID: pending.GuardianProfileID, CreatedBy: creator,
				})
			}
			require.NoError(t, err)
			after := testpkg.GuardianInvitationByID(t, env.db, *pending.InvitationID)
			assert.Equal(t, identityaccess.GuardianInvitationApprovalPending, after.ApprovalStatus)
			assert.Equal(t, before.ExpiresAt, after.ExpiresAt)
			assert.Equal(t, before.Email, after.Email)
			assert.False(t, env.linkExists(t, child.ID, pending.GuardianProfileID), "another invitation grants no access to this child")
			approvals, err := env.service.ListPendingApprovalsDetailed(ctx)
			require.NoError(t, err)
			require.Len(t, approvals, 1)
			assert.Equal(t, *pending.InvitationID, approvals[0].InvitationID)
		})
	}
}
