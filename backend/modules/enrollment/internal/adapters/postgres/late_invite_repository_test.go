package postgres_test

import (
	"context"
	"testing"
	"time"

	inviteOwner "github.com/moto-ogs/project-phoenix/modules/enrollment"
	ownerCompose "github.com/moto-ogs/project-phoenix/modules/enrollment/compose"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"

	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestLateInviteOwner_DeleteRequestTree_DeletesOnlyLinkedInvite(t *testing.T) {
	t.Parallel()

	// setupRequestRepoTest owns the package's testpkg.SetupTestDB lifecycle and
	// also creates the real tenant + phase fixtures this repository needs.
	db, requestRepo, tenantID, phaseID := setupRequestRepoTest(t)
	// The owner stamps the invites' creation from the same fixed clock their
	// expiry is set from (#7104), so expires_at > created_at on any day.
	lateInviteRepo := ownerCompose.NewClocked(func() time.Time { return lateInviteTestNow })
	tokenPrefix := uniqueToken("deleteUsedLateInvite")
	creator := testpkg.CreateTestAccount(t, db, "late-invite-delete")

	requestA := makeOwnerRequest(phaseID, tokenPrefix+"-request-a", "a@example.test")
	requestB := makeOwnerRequest(phaseID, tokenPrefix+"-request-b", "b@example.test")
	require.NoError(t, runInTenantTx(t, db, tenantID, func(ctx context.Context) error {
		if err := requestRepo.InsertRequest(ctx, requestA); err != nil {
			return err
		}
		return requestRepo.InsertRequest(ctx, requestB)
	}))

	inviteA := &inviteOwner.LateInvite{
		PhaseID:       phaseID,
		TokenHash:     tokenPrefix + "-invite-a",
		GuardianEmail: "a@example.test",
		ExpiresAt:     lateInviteTestNow.Add(24 * time.Hour),
		CreatedBy:     creator.ID,
	}
	inviteB := &inviteOwner.LateInvite{
		PhaseID:       phaseID,
		TokenHash:     tokenPrefix + "-invite-b",
		GuardianEmail: "b@example.test",
		ExpiresAt:     lateInviteTestNow.Add(24 * time.Hour),
		CreatedBy:     creator.ID,
	}
	require.NoError(t, runInTenantTx(t, db, tenantID, func(ctx context.Context) error {
		if err := lateInviteRepo.InsertLateInvite(ctx, inviteA); err != nil {
			return err
		}
		if err := lateInviteRepo.InsertLateInvite(ctx, inviteB); err != nil {
			return err
		}
		if err := lateInviteRepo.MarkLateInviteUsed(ctx, inviteA.ID, requestA.ID, lateInviteTestNow); err != nil {
			return err
		}
		return lateInviteRepo.MarkLateInviteUsed(ctx, inviteB.ID, requestB.ID, lateInviteTestNow)
	}))

	var linked *inviteOwner.LateInvite
	require.NoError(t, runInTenantTx(t, db, tenantID, func(ctx context.Context) error {
		var err error
		linked, err = lateInviteRepo.LateInviteByUsedRequestID(ctx, requestA.ID)
		return err
	}))
	require.NotNil(t, linked)
	assert.Equal(t, inviteA.ID, linked.ID)
	assert.Equal(t, "a@example.test", linked.GuardianEmail)

	require.NoError(t, runInTenantTx(t, db, tenantID, func(ctx context.Context) error {
		return requestRepo.DeleteRequestTree(ctx, requestA.ID)
	}))

	var remainingA, remainingB int
	require.NoError(t, db.NewRaw(`SELECT COUNT(*) FROM enrollment.late_invites WHERE id = ?`, inviteA.ID).Scan(context.Background(), &remainingA))
	require.NoError(t, db.NewRaw(`SELECT COUNT(*) FROM enrollment.late_invites WHERE id = ?`, inviteB.ID).Scan(context.Background(), &remainingB))
	assert.Zero(t, remainingA)
	assert.Equal(t, 1, remainingB)
}

// lateInviteTestNow is the fixed instant of the late-invite fixtures, a
// Wednesday 10:00 in Berlin.
var lateInviteTestNow = calendar.NewDate(2026, time.November, 18).BerlinMidnight().Add(10 * time.Hour)
