package parentaudience

import (
	"context"
	"testing"

	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/pgdialect"
)

func TestPermittedLetterChildrenRevokeDepartedChildrenIndividually(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	ctx := testpkg.Ctx(t)
	family := testpkg.CreateTestParentGuardianChain(t, db)
	alumnus := testpkg.CreateTestStudent(t, db, "Ehemalig", "Kind", "1a")
	deletedMembership := testpkg.CreateTestStudent(t, db, "Abgemeldet", "Kind", "1a")
	deletedPerson := testpkg.CreateTestStudent(t, db, "Gelöscht", "Kind", "1a")
	ids := []int64{family.StudentID, alumnus.ID, deletedMembership.ID, deletedPerson.ID}
	for _, id := range ids[1:] {
		testpkg.CreateTestStudentGuardianLink(t, db, id, family.GuardianProfileID, "primary_guardian")
	}
	letter := testpkg.CreateTestParentAnnouncement(t, db, family.AccountID, "Brief für Geschwister")
	_, err := db.NewUpdate().TableExpr("users.parent_announcements").
		Set("delivery_mode = 'letter'").Set("send_email = TRUE").Set("requires_acknowledgement = TRUE").
		Set("recipient_student_ids = ?", pgdialect.Array(ids)).
		Where("id = ?", letter.ID).Exec(ctx)
	require.NoError(t, err)
	testpkg.PublishTestParentAnnouncement(t, db, letter.ID)
	projection := New(func(context.Context) (bun.IDB, int64, error) { return db, 0, nil }, noApplicants{}, testpkg.GuardianLinks{})
	permitted, err := projection.PermittedLetterChildren(ctx, family.AccountID, []int64{letter.ID})
	require.NoError(t, err)
	require.ElementsMatch(t, ids, permitted[letter.ID])

	changes := []struct {
		query string
		id    int64
	}{
		{"UPDATE users.student_school_memberships SET status = 'alumnus' WHERE student_profile_id = ?", alumnus.ID},
		{"UPDATE users.student_school_memberships SET deleted_at = NOW() WHERE student_profile_id = ?", deletedMembership.ID},
		{"UPDATE users.persons SET deleted_at = NOW() WHERE id = ?", deletedPerson.PersonID},
	}
	for i, change := range changes {
		_, err := db.NewRaw(change.query, change.id).Exec(ctx)
		require.NoError(t, err)
		permitted, err = projection.PermittedLetterChildren(ctx, family.AccountID, []int64{letter.ID})
		require.NoError(t, err)
		remaining := append([]int64{family.StudentID}, ids[i+2:]...)
		require.ElementsMatch(t, remaining, permitted[letter.ID], "the active sibling remains authorized, departed children do not")
	}
}
