package parentportal_test

import (
	"context"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	testpkg "github.com/moto-ogs/project-phoenix/test"
	parentService "github.com/moto-ogs/project-phoenix/workflows/parentportal"
	parentportalcompose "github.com/moto-ogs/project-phoenix/workflows/parentportal/compose"
)

// roomHistoryStopSwitch is the Träger's switch for the parents' stop (#3844).
type roomHistoryStopSwitch struct{ on atomic.Bool }

func (s *roomHistoryStopSwitch) ResolveBoolForTenant(_ context.Context, _ int64, key string) (bool, error) {
	return key == parentService.KeyParentRoomHistoryStopEnabled && s.on.Load(), nil
}
func (*roomHistoryStopSwitch) ResolveStringForTenant(context.Context, int64, string) (string, error) {
	return "", nil
}
func (*roomHistoryStopSwitch) ResolveStringForTenantInTx(context.Context, int64, string) (string, error) {
	return "", nil
}
func (*roomHistoryStopSwitch) LockParentPickupChangePolicySharedForTenant(context.Context, int64) error {
	return nil
}

func roomHistoryRow(consents []parentService.ChildConsent) (parentService.ChildConsent, bool) {
	for _, consent := range consents {
		if consent.Key == "room_history" {
			return consent, true
		}
	}
	return parentService.ChildConsent{}, false
}

// TestParentRoomHistoryStopFollowsTheSwitchAndTheRelationship pins the
// parents' stop of #3844: without the Träger's switch the row is absent and
// the commands are refused; with it a guardian holding the consent right
// stops (deleting the room history, keeping the current room) and resumes,
// while a guardian without that right, another family and another school
// are refused.
func TestParentRoomHistoryStopFollowsTheSwitchAndTheRelationship(t *testing.T) {
	t.Parallel()
	toggle := &roomHistoryStopSwitch{}
	svc, db, _, _ := buildConsentServiceWith(t, func(deps *parentportalcompose.Dependencies) { deps.Settings = toggle })
	chain := testpkg.CreateTestParentGuardianChain(t, db)
	ctx := testpkg.WithPackageTenantRuntime(context.Background())
	group := testpkg.CreateTestActiveGroupForTenant(t, db, chain.TenantID)
	entry := time.Date(2026, 11, 20, 8, 0, 0, 0, time.UTC)
	_, err := db.ExecContext(testpkg.Ctx(t), `INSERT INTO active.visits (tenant_id, student_id, active_group_id, entry_time, exit_time)
		VALUES (?, ?, ?, ?, ?), (?, ?, ?, ?, NULL)`,
		chain.TenantID, chain.StudentID, group.ID, entry, entry.Add(time.Hour),
		chain.TenantID, chain.StudentID, group.ID, entry.Add(2*time.Hour))
	require.NoError(t, err)
	visits := func(closed bool) int {
		var count int
		require.NoError(t, db.NewRaw(`SELECT count(*) FROM active.visits WHERE tenant_id = ? AND student_id = ? AND (exit_time IS NOT NULL) = ?`,
			chain.TenantID, chain.StudentID, closed).Scan(testpkg.Ctx(t), &count))
		return count
	}

	consents, err := svc.GetChildConsents(ctx, chain.AccountID, chain.StudentID)
	require.NoError(t, err)
	_, shown := roomHistoryRow(consents)
	assert.False(t, shown, "without the Träger's switch parents see no stop")
	_, err = svc.StopChildRoomHistory(ctx, chain.AccountID, chain.StudentID)
	require.ErrorIs(t, err, parentService.ErrRoomHistoryStopDisabled)
	assert.Equal(t, 1, visits(true), "a refused stop deletes nothing")

	toggle.on.Store(true)
	consents, err = svc.GetChildConsents(ctx, chain.AccountID, chain.StudentID)
	require.NoError(t, err)
	row, shown := roomHistoryRow(consents)
	require.True(t, shown)
	assert.Equal(t, "recording", row.State)
	assert.True(t, row.CanWithdraw)

	t.Run("ohne Einwilligungsrecht", func(t *testing.T) {
		limited := testpkg.CreateTestCoGuardianForStudent(t, db, chain.StudentID, "Jonas", "Schneider")
		_, err := db.ExecContext(testpkg.WithPackageTenantRuntime(context.Background()), `
			UPDATE auth.guardian_student_access AS a
			SET permissions = '{"parent_portal.access": true}'::jsonb
			FROM users.student_guardian_relationships AS r
			WHERE r.tenant_id = a.tenant_id AND r.id = a.relationship_id
			  AND r.tenant_id = ? AND r.student_id = ? AND r.guardian_profile_id = ?
		`, limited.TenantID, chain.StudentID, limited.GuardianProfileID)
		require.NoError(t, err)
		consents, err := svc.GetChildConsents(ctx, limited.AccountID, chain.StudentID)
		require.NoError(t, err)
		row, shown := roomHistoryRow(consents)
		require.True(t, shown, "a guardian without the right still sees the state")
		assert.False(t, row.CanWithdraw)
		_, err = svc.StopChildRoomHistory(ctx, limited.AccountID, chain.StudentID)
		require.ErrorIs(t, err, parentService.ErrGuardianPermissionDenied)
	})
	t.Run("fremde Familie", func(t *testing.T) {
		stranger := testpkg.CreateTestParentGuardianChain(t, db)
		_, err := svc.StopChildRoomHistory(ctx, stranger.AccountID, chain.StudentID)
		require.ErrorIs(t, err, parentService.ErrChildNotLinked)
	})
	t.Run("fremde Schule", func(t *testing.T) {
		testpkg.OwnTenant(t)
		stranger := testpkg.CreateTestParentGuardianChain(t, db)
		_, err := svc.StopChildRoomHistory(ctx, stranger.AccountID, chain.StudentID)
		require.ErrorIs(t, err, parentService.ErrChildNotLinked)
	})
	assert.Equal(t, 1, visits(true), "refused guardians deleted nothing")

	consents, err = svc.StopChildRoomHistory(ctx, chain.AccountID, chain.StudentID)
	require.NoError(t, err)
	row, _ = roomHistoryRow(consents)
	assert.Equal(t, "stopped", row.State)
	assert.True(t, row.CanGrant)
	assert.NotNil(t, row.ChangedAt)
	assert.Zero(t, visits(true), "the room history is deleted")
	assert.Equal(t, 1, visits(false), "the current room stays")
	var source string
	require.NoError(t, db.NewRaw(`SELECT metadata->>'source' FROM audit.data_deletions WHERE tenant_id = ? AND student_id = ? AND deletion_type = 'room_history_stop'`,
		chain.TenantID, chain.StudentID).Scan(testpkg.Ctx(t), &source))
	assert.Equal(t, "parent_portal", source)

	consents, err = svc.ResumeChildRoomHistory(ctx, chain.AccountID, chain.StudentID)
	require.NoError(t, err)
	row, _ = roomHistoryRow(consents)
	assert.Equal(t, "recording", row.State)
	var changes int
	require.NoError(t, db.NewRaw(`SELECT count(*) FROM audit.student_field_edits WHERE tenant_id = ? AND student_id = ? AND field_name = 'room_history_stop' AND edited_by = ?`,
		chain.TenantID, chain.StudentID, chain.AccountID).Scan(testpkg.Ctx(t), &changes))
	assert.Equal(t, 2, changes, "stop and resume name the parent in the change history")
}
