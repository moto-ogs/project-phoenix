package migrations

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// TestDeviceLifecycleEventsGoWithTheSchoolAndRollBack erases a school with
// a device history (#2321): the entries go with the school, and after the
// rollback the erasure still runs without the table.
func TestDeviceLifecycleEventsGoWithTheSchoolAndRollBack(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupIsolatedTestDB(t)
	ctx := t.Context()

	school := testpkg.UniqueTestTenantID(t)
	testpkg.EnsureTestTenant(t, db, school)
	var deviceID int64
	require.NoError(t, db.NewRaw(`INSERT INTO iot.devices (tenant_id, device_id, device_type, status)
		VALUES (?, 'history-erasure', 'rfid_reader', 'active') RETURNING id`, school).Scan(ctx, &deviceID))
	_, err := db.ExecContext(ctx, `INSERT INTO audit.device_lifecycle_events (tenant_id, device_id, action, actor_kind, changes, occurred_at)
		VALUES (?, ?, 'created', 'school_staff', '{"name": {"after": "Eingang"}}', NOW())`, school, deviceID)
	require.NoError(t, err)
	result := eraseSchoolAsCLI(t, db, school, beginErasure(t, db, school))
	require.Equal(t, "db_done", result.Status)
	assert.EqualValues(t, 1, result.RowCounts["audit.device_lifecycle_events"], "the one entry of the school")

	// The room history stops (#3844) follow the device history at the head; they go first.

	// The pickup persons (#7655) follow the room history stops at the head; they go first.
	require.NoError(t, studentPickupPersonsDown(ctx, db))
	require.NoError(t, roomHistoryStopsDown(ctx, db))

	require.NoError(t, deviceLifecycleEventsDown(ctx, db))
	var exists bool
	require.NoError(t, db.NewRaw(`SELECT to_regclass('audit.device_lifecycle_events') IS NOT NULL`).Scan(ctx, &exists))
	assert.False(t, exists)
	for _, entry := range readErasurePlan(t, db) {
		assert.NotEqual(t, "audit.device_lifecycle_events", entry.Name)
	}
	other := testpkg.UniqueTestTenantID(t)
	testpkg.EnsureTestTenant(t, db, other)
	require.Equal(t, "db_done", eraseSchoolAsCLI(t, db, other, beginErasure(t, db, other)).Status, "the erasure works after the rollback")
}
