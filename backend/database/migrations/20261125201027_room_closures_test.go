package migrations

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// TestRoomClosuresGoWithTheSchoolAndRollBack erases a school with a closed
// room: the closure goes with the school, a closure of another school's room
// is refused, and after the rollback the erasure still runs without the
// table.
func TestRoomClosuresGoWithTheSchoolAndRollBack(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupIsolatedTestDB(t)
	ctx := t.Context()

	school := testpkg.UniqueTestTenantID(t)
	testpkg.EnsureTestTenant(t, db, school)
	other := testpkg.UniqueTestTenantID(t)
	testpkg.EnsureTestTenant(t, db, other)
	room := testpkg.CreateTestRoomForTenant(t, db, school, "Gesperrter Raum")
	foreign := testpkg.CreateTestRoomForTenant(t, db, other, "Fremder Raum")

	insert := `INSERT INTO facilities.room_closures (tenant_id, room_id, start_date, end_date, reason) VALUES (?, ?, ?, ?, ?)`
	_, err := db.ExecContext(ctx, insert, school, room.ID, "2026-11-30", "2026-12-02", "Wasserschaden")
	require.NoError(t, err)
	_, err = db.ExecContext(ctx, insert, school, foreign.ID, "2026-11-30", "2026-11-30", "Wasserschaden")
	require.Error(t, err, "a school cannot close another school's room")
	_, err = db.ExecContext(ctx, insert, school, room.ID, "2026-12-02", "2026-11-30", "Wasserschaden")
	require.Error(t, err, "the period ends on or after its start")
	_, err = db.ExecContext(ctx, insert, school, room.ID, "2026-12-02", "2026-12-02", "  ")
	require.Error(t, err, "a closure names its reason")

	result := eraseSchoolAsCLI(t, db, school, beginErasure(t, db, school))
	require.Equal(t, "db_done", result.Status, "preflight, deletion and residual checks pass: %v", result.ErrorCode)
	assert.EqualValues(t, 1, result.RowCounts["facilities.room_closures"], "the one closure of the school")

	require.NoError(t, roomClosuresDown(ctx, db))
	var exists bool
	require.NoError(t, db.NewRaw(`SELECT to_regclass('facilities.room_closures') IS NOT NULL`).Scan(ctx, &exists))
	assert.False(t, exists)
	for _, entry := range readErasurePlan(t, db) {
		assert.NotEqual(t, "facilities.room_closures", entry.Name)
	}
	require.Equal(t, "db_done", eraseSchoolAsCLI(t, db, other, beginErasure(t, db, other)).Status, "the erasure works after the rollback")

	require.NoError(t, roomClosuresUp(ctx, db), "the migration applies again")
}
