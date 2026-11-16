package test

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

// parentPickupRequestSetting is models/config.KeyParentCarePickupRequestEnabled.
// The fixtures may not import the settings owner's domain (the architecture
// policy keeps test support off it), so the key is spelled out here; a rename
// there fails the test that drives it, next to this line.
const parentPickupRequestSetting = "operations.parent_care_pickup_request_enabled"

// EnableParentPickupTimeRequests switches on the school setting a parent's
// pickup-time request needs, so a test can drive that request (#3468).
func EnableParentPickupTimeRequests(tb testing.TB, db *bun.DB, tenantID int64) {
	tb.Helper()
	SetTestTenantSetting(tb, db, tenantID, parentPickupRequestSetting, "true")
}

// SetTestTenantSetting stores a school's override of one setting as its
// config.setting_values row; jsonValue is the JSON the override holds. It
// skips the settings service's validation, so callers pass a valid value.
func SetTestTenantSetting(tb testing.TB, db *bun.DB, tenantID int64, key, jsonValue string) {
	tb.Helper()
	_, err := db.NewRaw(`INSERT INTO config.setting_values (tenant_id, setting_key, value)
		VALUES (?, ?, ?::jsonb) ON CONFLICT (tenant_id, setting_key) DO UPDATE SET value = EXCLUDED.value`,
		tenantID, key, jsonValue).Exec(context.Background())
	require.NoError(tb, err)
}

// devicePINSetting is models/config.KeyOGSDevicePIN, spelled out for the same
// reason as parentPickupRequestSetting.
const devicePINSetting = "security.ogs_device_pin"

// FixtureDevicePIN is the device PIN of every school a fixture device belongs
// to. The registry has no default PIN (#7175); like a school the migration kept
// on the former default, fixture schools hold 1234 as their own value, so a
// kiosk request of a test sends it as X-Staff-PIN.
const FixtureDevicePIN = "1234"

// ensureFixtureDevicePIN gives the school the fixture device PIN unless the
// test already stored a PIN of its own.
func ensureFixtureDevicePIN(tb testing.TB, db *bun.DB, tenantID int64) {
	tb.Helper()
	_, err := db.NewRaw(`INSERT INTO config.setting_values (tenant_id, setting_key, value)
		VALUES (?, ?, to_jsonb(?::text)) ON CONFLICT (tenant_id, setting_key) DO NOTHING`,
		tenantID, devicePINSetting, FixtureDevicePIN).Exec(context.Background())
	require.NoError(tb, err, "Failed to store the fixture device PIN")
}
