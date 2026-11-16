package parentaudience

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/pgdialect"

	"github.com/moto-ogs/project-phoenix/modules/parentannouncementaudience/contract"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// A child's record (#4814) lists the published letters and declarations
// that reached it: recorded children once published, the targets of today
// for a publication from before the record, and a declaration a guardian
// answered for the child even after the record no longer names it. Drafts,
// plain announcements and letters to other children stay out.
func TestStudentAnnouncementsListWhatReachedTheChild(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	ctx := testpkg.Ctx(t)
	tenantID := testpkg.Tenant(t)
	family := testpkg.CreateTestParentGuardianChain(t, db)
	other := testpkg.CreateTestStudent(t, db, "Andere", "Klasse", "4c")

	announce := func(title, mode string, recorded []int64, classTarget string, publish bool) int64 {
		a := testpkg.CreateTestParentAnnouncement(t, db, family.AccountID, title)
		q := db.NewUpdate().TableExpr("users.parent_announcements").Set("delivery_mode = ?", mode).Where("id = ?", a.ID)
		switch mode {
		case "letter":
			q = q.Set("send_email = TRUE").Set("requires_acknowledgement = TRUE")
		case "declaration":
			q = q.Set("declaration_kind = 'consent'").Set("declaration_signers = 'any'")
		}
		if recorded != nil {
			q = q.Set("recipient_student_ids = ?", pgdialect.Array(recorded))
		}
		_, err := q.Exec(ctx)
		require.NoError(t, err)
		_, err = db.NewRaw(`INSERT INTO users.parent_announcement_targets (tenant_id, announcement_id, target_type, target_ref_text)
			VALUES (?, ?, 'class', ?)`, tenantID, a.ID, classTarget).Exec(ctx)
		require.NoError(t, err)
		if publish {
			testpkg.PublishTestParentAnnouncement(t, db, a.ID)
		}
		return a.ID
	}
	recorded := announce("Recorded letter", "letter", []int64{family.StudentID}, "4c", true)
	legacy := announce("Legacy letter", "letter", nil, "1a", true)
	answered := announce("Answered consent", "declaration", []int64{other.ID}, "4c", true)
	announce("Other child", "letter", []int64{other.ID}, "1a", true)
	announce("Draft letter", "letter", nil, "1a", false)
	announce("Plain news", "standard", []int64{family.StudentID}, "1a", true)

	_, err := db.NewRaw(`INSERT INTO users.parent_announcement_reads (tenant_id, announcement_id, account_id, acknowledged_at)
		VALUES (?, ?, ?, NOW())`, tenantID, recorded, family.AccountID).Exec(ctx)
	require.NoError(t, err)

	projection := New(func(context.Context) (bun.IDB, int64, error) { return db, 0, nil }, noApplicants{}, testpkg.GuardianLinks{})
	history := []contract.DeclarationHistoryLink{
		{TenantID: tenantID, AnnouncementID: answered, StudentID: family.StudentID},
		// Another child's answer names nothing of this child.
		{TenantID: tenantID, AnnouncementID: answered + 1000, StudentID: other.ID},
	}
	rows, err := projection.StudentAnnouncements(ctx, tenantID, family.StudentID, history)
	require.NoError(t, err)
	byID := map[int64]*contract.StudentAnnouncement{}
	for _, row := range rows {
		byID[row.AnnouncementID] = row
	}
	require.Len(t, rows, 3)
	require.Contains(t, byID, recorded)
	require.Contains(t, byID, legacy, "a publication from before the record follows the targets of today")
	require.Contains(t, byID, answered, "an answered declaration stays in the child's record")
	require.NotNil(t, byID[recorded].AcknowledgedAt)
	require.True(t, byID[recorded].CanConfirm)
	require.Nil(t, byID[legacy].AcknowledgedAt)
	require.Equal(t, "declaration", byID[answered].DeliveryMode)

	// Another school does not reach the child, and an unknown child is no
	// child of any school.
	foreign, _ := testpkg.CreateTestTenant(t, db)
	_, err = projection.StudentAnnouncements(ctx, foreign, family.StudentID, nil)
	require.ErrorIs(t, err, contract.ErrStudentNotInSchool)
	_, err = projection.StudentAnnouncements(ctx, tenantID, 999999999, nil)
	require.ErrorIs(t, err, contract.ErrStudentNotInSchool)
}
