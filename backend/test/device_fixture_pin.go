package test

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

// devicePINSetting is models/config.KeyOGSDevicePIN. The fixtures may not
// import the settings owner's domain, so the key is spelled out here.
const devicePINSetting = "security.ogs_device_pin"

// FixtureDevicePIN is the device PIN of every school a fixture device belongs
// to. The registry has no default PIN (#7175); like a school the migration kept
// on the former default, fixture schools hold 1234 as their own value, so a
// kiosk request of a test sends it as X-Staff-PIN.
const FixtureDevicePIN = "1234"

// insertTestDevice stores a fixture device and gives its school the fixture
// device PIN unless the test already stored a PIN of its own.
func insertTestDevice(tb testing.TB, db *bun.DB, device *Device, failure string) {
	tb.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	require.NoError(tb, db.NewInsert().Model(device).ModelTableExpr(`iot.devices`).Scan(ctx), failure)
	_, err := db.NewRaw(`INSERT INTO config.setting_values (tenant_id, setting_key, value)
		VALUES (?, ?, to_jsonb(?::text)) ON CONFLICT (tenant_id, setting_key) DO NOTHING`,
		device.TenantID, devicePINSetting, FixtureDevicePIN).Exec(ctx)
	require.NoError(tb, err, "Failed to store the fixture device PIN")
}
