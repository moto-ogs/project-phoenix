package migrations

import (
	"testing"

	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// The school erasure deletes the opening changes of the school, and the
// migration rolls back to the erasure without the table and applies again
// (#7654).
func TestOpeningChangesGoWithTheSchoolAndRollBack(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupIsolatedTestDB(t)
	ctx := t.Context()
	exists := func() bool {
		var found bool
		require.NoError(t, db.NewRaw(`SELECT to_regclass('schedule.opening_changes') IS NOT NULL`).Scan(ctx, &found))
		return found
	}

	school := testpkg.UniqueTestTenantID(t)
	testpkg.EnsureTestTenant(t, db, school)
	_, err := db.ExecContext(ctx, `INSERT INTO schedule.opening_changes (tenant_id, start_date, end_date, opens_at, closes_at, reason)
		VALUES (?, '2031-01-17', '2031-01-17', '07:30', '12:00', 'Zeugnisausgabe')`, school)
	require.NoError(t, err)
	result := eraseSchoolAsCLI(t, db, school, beginErasure(t, db, school))
	require.Equal(t, "db_done", result.Status, "preflight, deletion and residual checks pass: %v", result.ErrorCode)
	assert.EqualValues(t, 1, result.RowCounts["schedule.opening_changes"], "the one day of the school")

	// The pickup persons follow the opening changes at the head and roll back first.
	require.NoError(t, studentPickupPersonsDown(ctx, db))
	require.NoError(t, openingChangesDown(ctx, db))
	assert.False(t, exists())
	for _, entry := range readErasurePlan(t, db) {
		assert.NotEqual(t, "schedule.opening_changes", entry.Name)
	}
	other := testpkg.UniqueTestTenantID(t)
	testpkg.EnsureTestTenant(t, db, other)
	require.Equal(t, "db_done", eraseSchoolAsCLI(t, db, other, beginErasure(t, db, other)).Status, "the erasure works after the rollback")

	require.NoError(t, openingChangesUp(ctx, db), "the migration applies again")
	require.NoError(t, studentPickupPersonsUp(ctx, db), "the later pickup-person migration applies again")
	require.NoError(t, applyRepeatableDefinitions(ctx, db))
	assert.True(t, exists())
	again := testpkg.UniqueTestTenantID(t)
	testpkg.EnsureTestTenant(t, db, again)
	require.Equal(t, "db_done", eraseSchoolAsCLI(t, db, again, beginErasure(t, db, again)).Status, "the erasure works after the table is back")
}
