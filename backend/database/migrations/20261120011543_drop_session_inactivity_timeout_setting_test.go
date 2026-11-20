package migrations

import (
	"context"
	"testing"

	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestDropSessionInactivityTimeoutSettingKeepsOtherSettings(t *testing.T) {
	t.Parallel()
	settingsCleanupMigrationTests.Lock()
	defer settingsCleanupMigrationTests.Unlock()
	db := testpkg.SetupTestDB(t)
	ctx := context.Background()

	school, _ := testpkg.CreateTestTenant(t, db)
	settingsCleanupStore(t, db, school, dropSessionInactivityTimeoutSettingKey, `45`)
	settingsCleanupStore(t, db, school, "operations.session_abandoned_threshold_minutes", `90`)

	require.NoError(t, dropSessionInactivityTimeoutSettingUp(ctx, db))
	require.NoError(t, dropSessionInactivityTimeoutSettingUp(ctx, db), "a second run changes nothing")

	_, ok := settingsCleanupValue(t, db, school, dropSessionInactivityTimeoutSettingKey)
	assert.False(t, ok)
	var audits int
	require.NoError(t, db.NewRaw(`
		SELECT COUNT(*) FROM config.setting_audit WHERE tenant_id = ? AND setting_key = ?
	`, school, dropSessionInactivityTimeoutSettingKey).Scan(ctx, &audits))
	assert.Zero(t, audits)
	value, ok := settingsCleanupValue(t, db, school, "operations.session_abandoned_threshold_minutes")
	require.True(t, ok, "the neighbouring cleanup threshold stays")
	assert.Equal(t, `90`, value)
}
