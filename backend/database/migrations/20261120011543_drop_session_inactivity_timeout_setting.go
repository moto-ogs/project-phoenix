package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

const (
	dropSessionInactivityTimeoutSettingVersion = "20261120011543"
	dropSessionInactivityTimeoutSettingKey     = "operations.session_inactivity_timeout_minutes"
)

func init() {
	MigrationRegistry.Register(&Migration{
		Version:     dropSessionInactivityTimeoutSettingVersion,
		Description: "Gespeicherte Werte der entfernten Einstellung Standard-Sitzungstimeout löschen (#2352)",
		DependsOn:   []string{configSettingValuesVersion},
	})
	Migrations.MustRegister(dropSessionInactivityTimeoutSettingUp, dropSessionInactivityTimeoutSettingDown)
}

// dropSessionInactivityTimeoutSettingUp deletes the school overrides and audit
// rows of operations.session_inactivity_timeout_minutes. Its only reader was
// the removed kiosk route GET /api/iot/session/timeout-info, so the registry
// definition is gone and the rows would be orphans. The setting was
// operator_only and therefore never had a Träger value. The superuser
// connection bypasses RLS on both tables.
func dropSessionInactivityTimeoutSettingUp(ctx context.Context, db *bun.DB) error {
	if _, err := db.ExecContext(ctx,
		`DELETE FROM config.setting_values WHERE setting_key = ?`,
		dropSessionInactivityTimeoutSettingKey,
	); err != nil {
		return fmt.Errorf("delete setting_values: %w", err)
	}
	if _, err := db.ExecContext(ctx,
		`DELETE FROM config.setting_audit WHERE setting_key = ?`,
		dropSessionInactivityTimeoutSettingKey,
	); err != nil {
		return fmt.Errorf("delete setting_audit: %w", err)
	}
	return nil
}

// dropSessionInactivityTimeoutSettingDown is a no-op: the registry definition
// is gone, so there is nothing meaningful to restore.
func dropSessionInactivityTimeoutSettingDown(context.Context, *bun.DB) error {
	return nil
}
