package migrations

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// TestParentLetterCopiesGoWithTheSchoolAndRollBack erases a school that has
// a letter copy, then rolls the migration back and forward: the erasure
// works with and without the copies (#4813).
func TestParentLetterCopiesGoWithTheSchoolAndRollBack(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupIsolatedTestDB(t)
	ctx := t.Context()
	exists := func() bool {
		var found bool
		require.NoError(t, db.NewRaw(`SELECT to_regclass('users.parent_announcement_letter_copies') IS NOT NULL`).Scan(ctx, &found))
		return found
	}
	erases := func(message string) {
		school := testpkg.UniqueTestTenantID(t)
		testpkg.EnsureTestTenant(t, db, school)
		require.Equal(t, "db_done", eraseSchoolAsCLI(t, db, school, beginErasure(t, db, school)).Status, message)
	}

	school := testpkg.UniqueTestTenantID(t)
	testpkg.EnsureTestTenant(t, db, school)
	student := testpkg.CreateTestStudentForTenant(t, db, school, "Lina", "Muster", "1a")
	_, author := testpkg.CreateTestStaffWithAccountForTenant(t, db, school, "Paula", "Kern")
	var announcementID int64
	require.NoError(t, db.NewRaw(`INSERT INTO users.parent_announcements (tenant_id, title, body, created_by, published_at, delivery_mode, send_email, requires_acknowledgement)
		VALUES (?, 'Sommerfest', 'Hallo {{vorname}}', ?, NOW(), 'letter', TRUE, TRUE) RETURNING id`, school, author.ID).Scan(ctx, &announcementID))
	_, err := db.ExecContext(ctx, `INSERT INTO users.parent_announcement_letter_copies (tenant_id, announcement_id, student_id, first_name, body, published_at)
		VALUES (?, ?, ?, 'Lina', 'Hallo Lina', NOW())`, school, announcementID, student.ID)
	require.NoError(t, err)
	result := eraseSchoolAsCLI(t, db, school, beginErasure(t, db, school))
	require.Equal(t, "db_done", result.Status)
	assert.EqualValues(t, 1, result.RowCounts["users.parent_announcement_letter_copies"], "the one copy of the school")

	require.NoError(t, parentLetterCopiesDown(ctx, db))
	assert.False(t, exists())
	for _, entry := range readErasurePlan(t, db) {
		assert.NotEqual(t, "users.parent_announcement_letter_copies", entry.Name)
	}
	erases("the erasure works after the rollback")

	require.NoError(t, parentLetterCopiesUp(ctx, db))
	require.NoError(t, applyRepeatableDefinitions(ctx, db))
	assert.True(t, exists())
	erases("the erasure works after the copies are back")
}
