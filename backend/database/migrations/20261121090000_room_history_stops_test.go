package migrations

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"

	testpkg "github.com/moto-ogs/project-phoenix/test"
)

func countStudentVisits(t *testing.T, db bun.IDB, schoolID, studentID int64, closed bool) int {
	t.Helper()
	var rows int
	require.NoError(t, db.NewRaw(`SELECT count(*) FROM active.visits WHERE tenant_id = ? AND student_id = ? AND (exit_time IS NOT NULL) = ?`,
		schoolID, studentID, closed).Scan(t.Context(), &rows))
	return rows
}

// TestRoomHistoryStopKeepsOnlyOpenVisits pins the trigger of #3844: a
// stopped child keeps its open visit (the current room), a visit written
// closed by an update or an insert is gone at once, and a child without a
// stop keeps its history.
func TestRoomHistoryStopKeepsOnlyOpenVisits(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	ctx := t.Context()
	school := testpkg.UniqueTestTenantID(t)
	testpkg.EnsureTestTenant(t, db, school)
	stopped := testpkg.CreateTestStudentForTenant(t, db, school, "Stopp", "Kind", "2b")
	tracked := testpkg.CreateTestStudentForTenant(t, db, school, "Verlauf", "Kind", "2b")
	group := testpkg.CreateTestActiveGroupForTenant(t, db, school)
	_, err := db.ExecContext(ctx, `INSERT INTO active.room_history_stops (tenant_id, student_id, stopped_at) VALUES (?, ?, NOW())`, school, stopped.ID)
	require.NoError(t, err)

	entry := time.Date(2026, 11, 20, 8, 0, 0, 0, time.UTC)
	for _, student := range []int64{stopped.ID, tracked.ID} {
		_, err = db.ExecContext(ctx, `INSERT INTO active.visits (tenant_id, student_id, active_group_id, entry_time) VALUES (?, ?, ?, ?)`,
			school, student, group.ID, entry)
		require.NoError(t, err)
	}
	assert.Equal(t, 1, countStudentVisits(t, db, school, stopped.ID, false), "the current room stays visible")

	_, err = db.ExecContext(ctx, `UPDATE active.visits SET exit_time = ? WHERE tenant_id = ? AND exit_time IS NULL`, entry.Add(time.Hour), school)
	require.NoError(t, err)
	assert.Zero(t, countStudentVisits(t, db, school, stopped.ID, true), "a closed visit of a stopped child is not kept")
	assert.Equal(t, 1, countStudentVisits(t, db, school, tracked.ID, true), "the other child keeps its history")

	_, err = db.ExecContext(ctx, `INSERT INTO active.visits (tenant_id, student_id, active_group_id, entry_time, exit_time) VALUES (?, ?, ?, ?, ?)`,
		school, stopped.ID, group.ID, entry, entry.Add(time.Minute))
	require.NoError(t, err)
	assert.Zero(t, countStudentVisits(t, db, school, stopped.ID, true), "a backfilled closed visit is not kept either")
}

// TestRoomHistoryStopsGoWithTheSchoolAndRollBack erases a school with a
// stopped child: the stop goes with the school, and after the rollback the
// erasure still runs without the table and the trigger.
func TestRoomHistoryStopsGoWithTheSchoolAndRollBack(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupIsolatedTestDB(t)
	ctx := t.Context()

	school := testpkg.UniqueTestTenantID(t)
	testpkg.EnsureTestTenant(t, db, school)
	student := testpkg.CreateTestStudentForTenant(t, db, school, "Stopp", "Löschung", "3a")
	_, err := db.ExecContext(ctx, `INSERT INTO active.room_history_stops (tenant_id, student_id, stopped_at) VALUES (?, ?, NOW())`, school, student.ID)
	require.NoError(t, err)
	result := eraseSchoolAsCLI(t, db, school, beginErasure(t, db, school))
	require.Equal(t, "db_done", result.Status, "preflight, deletion and residual checks pass: %v", result.ErrorCode)
	assert.EqualValues(t, 1, result.RowCounts["active.room_history_stops"], "the one stop of the school")

	require.NoError(t, roomClosuresDown(ctx, db))
	require.NoError(t, roomHistoryStopsDown(ctx, db))
	var exists bool
	require.NoError(t, db.NewRaw(`SELECT to_regclass('active.room_history_stops') IS NOT NULL`).Scan(ctx, &exists))
	assert.False(t, exists)
	for _, entry := range readErasurePlan(t, db) {
		assert.NotEqual(t, "active.room_history_stops", entry.Name)
	}
	other := testpkg.UniqueTestTenantID(t)
	testpkg.EnsureTestTenant(t, db, other)
	require.Equal(t, "db_done", eraseSchoolAsCLI(t, db, other, beginErasure(t, db, other)).Status, "the erasure works after the rollback")

	require.NoError(t, roomHistoryStopsUp(ctx, db), "the migration applies again")
}
