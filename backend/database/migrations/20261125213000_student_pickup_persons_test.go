package migrations

import (
	"testing"

	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/require"
)

// Migration 20261125213000 holds who collects a child on one day (#7655):
// one person per child and day, never without a name, and a removed contact
// takes its day value along.
func TestStudentPickupPersonsConstraints(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	ctx := testpkg.Ctx(t)
	tenantID := testpkg.Tenant(t)
	student := testpkg.CreateTestStudent(t, db, "Mila", "Abholung", "3a")
	grandma := testpkg.CreateTestGuardianProfileNamed(t, db, "Oma", "Berta", "migration-oma")

	insert := func(date, name string, guardianProfileID any) error {
		_, err := db.ExecContext(ctx, `
			INSERT INTO schedule.student_pickup_persons (tenant_id, student_id, exception_date, person_name, guardian_profile_id)
			VALUES (?, ?, ?, ?, ?)`, tenantID, student.ID, date, name, guardianProfileID)
		return err
	}

	require.NoError(t, insert("2026-09-09", "Oma Berta", grandma.ID))
	require.ErrorContains(t, insert("2026-09-09", "Tante Frieda", nil), "uq_student_pickup_persons_day")
	require.ErrorContains(t, insert("2026-09-10", "  ", nil), "chk_student_pickup_persons_name")
	require.NoError(t, insert("2026-09-10", "Tante Frieda", nil))

	_, err := db.ExecContext(ctx, `DELETE FROM users.guardian_profiles WHERE tenant_id = ? AND id = ?`, tenantID, grandma.ID)
	require.NoError(t, err)
	var left []string
	require.NoError(t, db.NewRaw(`SELECT person_name FROM schedule.student_pickup_persons WHERE tenant_id = ? AND student_id = ? ORDER BY exception_date`,
		tenantID, student.ID).Scan(ctx, &left))
	require.Equal(t, []string{"Tante Frieda"}, left)
}

// The school erasure deletes the pickup persons with the school; the down
// takes the table out of every erasure function, after which the erasure of
// another school still runs, and the migration applies again.
func TestStudentPickupPersonsGoWithTheSchoolAndRollBack(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupIsolatedTestDB(t)
	ctx := t.Context()

	school := testpkg.UniqueTestTenantID(t)
	testpkg.EnsureTestTenant(t, db, school)
	student := testpkg.CreateTestStudentForTenant(t, db, school, "Abholung", "Löschung", "3a")
	_, err := db.ExecContext(ctx, `INSERT INTO schedule.student_pickup_persons (tenant_id, student_id, exception_date, person_name)
		VALUES (?, ?, '2026-09-09', 'Tante Frieda')`, school, student.ID)
	require.NoError(t, err)
	result := eraseSchoolAsCLI(t, db, school, beginErasure(t, db, school))
	require.Equal(t, "db_done", result.Status, "preflight, deletion and residual checks pass: %v", result.ErrorCode)
	require.EqualValues(t, 1, result.RowCounts["schedule.student_pickup_persons"], "the one pickup person of the school")

	require.NoError(t, studentPickupPersonsDown(ctx, db))
	var exists bool
	require.NoError(t, db.NewRaw(`SELECT to_regclass('schedule.student_pickup_persons') IS NOT NULL`).Scan(ctx, &exists))
	require.False(t, exists)
	for _, entry := range readErasurePlan(t, db) {
		require.NotEqual(t, "schedule.student_pickup_persons", entry.Name)
	}
	other := testpkg.UniqueTestTenantID(t)
	testpkg.EnsureTestTenant(t, db, other)
	require.Equal(t, "db_done", eraseSchoolAsCLI(t, db, other, beginErasure(t, db, other)).Status, "the erasure works after the rollback")

	require.NoError(t, studentPickupPersonsUp(ctx, db), "the migration applies again")
}
