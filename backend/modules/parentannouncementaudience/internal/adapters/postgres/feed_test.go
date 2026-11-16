package parentaudience

import (
	"context"
	"testing"

	"github.com/moto-ogs/project-phoenix/modules/parentannouncementaudience/contract"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

// The feed and its outstanding count start from the account's children
// (#7231). A read poll stays outstanding only while one of those children is
// unanswered AND the account may answer for it.
func TestOutstandingCountKeepsAReadPollOnlyWhileTheAccountMayAnswer(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	ctx := testpkg.Ctx(t)
	family := testpkg.CreateTestParentGuardianChain(t, db)
	poll := testpkg.CreateTestParentAnnouncement(t, db, family.AccountID, "Umfrage")
	exec := func(query string, args ...any) {
		t.Helper()
		_, err := db.NewRaw(query, args...).Exec(ctx)
		require.NoError(t, err)
	}
	exec(`UPDATE users.parent_announcements SET response_type = 'single_choice' WHERE id = ?`, poll.ID)
	exec(`INSERT INTO users.parent_announcement_targets (tenant_id, announcement_id, target_type) VALUES (?, ?, 'school_all')`, family.TenantID, poll.ID)
	var optionID int64
	require.NoError(t, db.NewRaw(`INSERT INTO users.parent_announcement_options (tenant_id, announcement_id, label, position)
		VALUES (?, ?, 'Ja', 1) RETURNING id`, family.TenantID, poll.ID).Scan(ctx, &optionID))
	testpkg.PublishTestParentAnnouncement(t, db, poll.ID)
	exec(`INSERT INTO users.parent_announcement_reads (tenant_id, announcement_id, account_id, read_at) VALUES (?, ?, ?, NOW())`,
		family.TenantID, poll.ID, family.AccountID)

	projection := New(func(context.Context) (bun.IDB, int64, error) { return db, 0, nil }, noApplicants{}, testpkg.GuardianLinks{})
	scope := contract.ParentAnnouncementFeedScope{TenantIDs: []int64{family.TenantID}}
	assertState := func(wantOutstanding int, msg string) {
		t.Helper()
		feed, err := projection.ListFeedForAccount(ctx, family.AccountID, scope)
		require.NoError(t, err)
		require.Len(t, feed, 1, "the poll stays in the feed: %s", msg)
		require.Equal(t, poll.ID, feed[0].ID)
		count, err := projection.CountOutstandingForAccount(ctx, family.AccountID, scope)
		require.NoError(t, err)
		require.Equal(t, wantOutstanding, count, msg)
	}
	assertState(1, "a read poll with an unanswered child stays outstanding")

	var linkID int64
	require.NoError(t, db.NewRaw(`SELECT id FROM users.student_guardian_relationships WHERE student_id = ? AND guardian_profile_id = ?`,
		family.StudentID, family.GuardianProfileID).Scan(ctx, &linkID))
	require.NoError(t, testpkg.SetTestStudentGuardianPermissions(ctx, db, linkID, map[string]any{"parent_portal.access": true}))
	assertState(0, "an account that may not answer for the child is not nagged")

	require.NoError(t, testpkg.SetTestStudentGuardianPermissions(ctx, db, linkID, map[string]any{
		"parent_portal.access": true, "parent_portal.poll.response": true,
	}))
	assertState(1, "regaining poll.response makes the unanswered child count again")
	exec(`INSERT INTO users.parent_announcement_responses (tenant_id, announcement_id, option_id, student_id, account_id) VALUES (?, ?, ?, ?, ?)`,
		family.TenantID, poll.ID, optionID, family.StudentID, family.AccountID)
	assertState(0, "an answered child clears the poll")

	require.NoError(t, testpkg.SetTestStudentGuardianPermissions(ctx, db, linkID, map[string]any{"parent_portal.poll.response": true}))
	feed, err := projection.ListFeedForAccount(ctx, family.AccountID, scope)
	require.NoError(t, err)
	require.Empty(t, feed, "without parent_portal.access the account no longer reaches the child")
}
