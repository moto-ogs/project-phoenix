package migrations

import (
	"context"
	"testing"

	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

// TestDevicePermissionsMoveEveryRole pins #2312: iot:read becomes
// devices:read, iot:update and iot:manage become devices:manage, a role that
// may manage devices also sees them, and no iot:* permission is left.
func TestDevicePermissionsMoveEveryRole(t *testing.T) {
	t.Parallel()

	db := testpkg.SetupIsolatedTestDB(t)
	ctx := context.Background()
	require.NoError(t, deviceSlotsAndPermissionsDown(ctx, db))

	reader := createRoleWith(t, db, "device-test-reader", "iot:read")
	updater := createRoleWith(t, db, "device-test-updater", "iot:update")
	manager := createRoleWith(t, db, "device-test-manager", "iot:read", "iot:manage")
	unrelated := createRoleWith(t, db, "device-test-unrelated", "users:read")

	require.NoError(t, deviceSlotsAndPermissionsUp(ctx, db))

	assert.Equal(t, []string{"devices:read"}, devicePermissionsOfRole(t, db, reader))
	assert.Equal(t, []string{"devices:manage", "devices:read"}, devicePermissionsOfRole(t, db, updater),
		"editing and blocking are device management now, and managing needs the page")
	assert.Equal(t, []string{"devices:manage", "devices:read"}, devicePermissionsOfRole(t, db, manager))
	assert.Empty(t, devicePermissionsOfRole(t, db, unrelated))
	var left int
	require.NoError(t, db.NewRaw(`SELECT count(*) FROM auth.permissions WHERE name LIKE 'iot:%'`).Scan(ctx, &left))
	assert.Zero(t, left, "no iot:* permission is left")

	require.NoError(t, deviceSlotsAndPermissionsDown(ctx, db))
	assert.Equal(t, []string{"iot:read"}, devicePermissionsOfRole(t, db, reader))
	require.NoError(t, deviceSlotsAndPermissionsUp(ctx, db))
}

func devicePermissionsOfRole(t *testing.T, db *bun.DB, roleID int64) []string {
	t.Helper()
	var names []string
	require.NoError(t, db.NewRaw(`
		SELECT p.name FROM auth.role_permissions AS rp
		JOIN auth.permissions AS p ON p.id = rp.permission_id
		WHERE rp.role_id = ? AND p.resource IN ('devices', 'iot')
		ORDER BY p.name
	`, roleID).Scan(context.Background(), &names))
	return names
}
