package migrations

import (
	"context"
	"testing"

	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Schools using NFC without a PIN of their own keep 1234, so no tablet stops
// on the deployment; a school's own PIN, even an empty one, stays, and a school
// without NFC gets no PIN (#7175).
func TestDevicePINKeepsFormerDefault(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	ctx := context.Background()
	noPIN := testpkg.Tenant(t)
	ownPIN, _ := testpkg.CreateTestTenant(t, db)
	emptyPIN, _ := testpkg.CreateTestTenant(t, db)
	noNFC, _ := testpkg.CreateTestTenant(t, db)

	_, err := db.ExecContext(ctx, `
		INSERT INTO config.setting_values (tenant_id, setting_key, value)
		VALUES (?, 'security.ogs_device_pin', '"4729"'::jsonb),
		       (?, 'security.ogs_device_pin', '""'::jsonb),
		       (?, 'module.nfc_anwesenheit', 'false'::jsonb)`,
		ownPIN, emptyPIN, noNFC)
	require.NoError(t, err)

	require.NoError(t, devicePINKeepsFormerDefaultUp(ctx, db))

	pin := func(tenantID int64) string {
		var value string
		require.NoError(t, db.NewRaw(`
			SELECT value #>> '{}' FROM config.setting_values
			WHERE tenant_id = ? AND setting_key = 'security.ogs_device_pin'`, tenantID).
			Scan(ctx, &value))
		return value
	}
	assert.Equal(t, "1234", pin(noPIN), "a school on the former default keeps it")
	assert.Equal(t, "4729", pin(ownPIN), "a school's own PIN stays")
	assert.Equal(t, "", pin(emptyPIN), "an explicit empty PIN stays")
	var noNFCPins int
	require.NoError(t, db.NewRaw(`SELECT count(*) FROM config.setting_values
		WHERE tenant_id = ? AND setting_key = 'security.ogs_device_pin'`, noNFC).Scan(ctx, &noNFCPins))
	assert.Zero(t, noNFCPins, "a school without NFC sets its own PIN when it books NFC")

	var audited []struct {
		TenantID int64  `bun:"tenant_id"`
		NewValue string `bun:"new_value"`
	}
	require.NoError(t, db.NewRaw(`
		SELECT tenant_id, new_value #>> '{}' AS new_value FROM config.setting_audit
		WHERE tenant_id IN (?, ?, ?) AND setting_key = 'security.ogs_device_pin'
		  AND action = 'set' AND changed_by IS NULL`,
		noPIN, ownPIN, emptyPIN).Scan(ctx, &audited))
	require.Len(t, audited, 1, "only the kept value is audited")
	assert.Equal(t, noPIN, audited[0].TenantID)
	assert.Equal(t, "[REDACTED]", audited[0].NewValue, "the audit never carries the PIN")
}

// An explicit 1234 may have been a school's choice before this migration.
// Rolling back cannot safely distinguish it from the compatibility value the
// migration created, and the previous registry default accepts both.
func TestDevicePINKeepsFormerDefaultDownPreservesPINOverrides(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	ctx := context.Background()
	formerDefault, _ := testpkg.CreateTestTenant(t, db)
	migrated, _ := testpkg.CreateTestTenant(t, db)

	_, err := db.ExecContext(ctx, `
		INSERT INTO config.setting_values (tenant_id, setting_key, value)
		VALUES (?, 'security.ogs_device_pin', '"1234"'::jsonb)`, formerDefault)
	require.NoError(t, err)

	require.NoError(t, devicePINKeepsFormerDefaultUp(ctx, db))
	require.NoError(t, devicePINKeepsFormerDefaultDown(ctx, db))

	for _, tenantID := range []int64{formerDefault, migrated} {
		var value string
		require.NoError(t, db.NewRaw(`
			SELECT value #>> '{}' FROM config.setting_values
			WHERE tenant_id = ? AND setting_key = 'security.ogs_device_pin'`, tenantID).
			Scan(ctx, &value))
		assert.Equal(t, "1234", value)
	}
}
