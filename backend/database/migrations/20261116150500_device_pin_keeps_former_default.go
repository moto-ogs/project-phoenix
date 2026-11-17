package migrations

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/uptrace/bun"
)

const (
	devicePINKeepsFormerDefaultVersion     = "20261116150500"
	devicePINKeepsFormerDefaultDescription = "Geräte-PIN: Schulen ohne eigene PIN behalten 1234 als eigenen Wert (#7175)"
)

func init() {
	MigrationRegistry.Register(&Migration{
		Version:     devicePINKeepsFormerDefaultVersion,
		Description: devicePINKeepsFormerDefaultDescription,
		DependsOn:   []string{configSettingValuesVersion, moduleNFCSwitchVersion},
	})

	Migrations.MustRegister(devicePINKeepsFormerDefaultUp, devicePINKeepsFormerDefaultDown)
}

// devicePINKeepsFormerDefaultUp gives every school that uses NFC-Anwesenheit
// and has no device PIN of its own the former registry default 1234 as an
// explicit value (#7175). The module switch defaults to booked, so only an
// explicit false leaves a school out; such a school sets its own PIN when it
// books NFC later. The
// registry default becomes empty, and an empty PIN locks the tablets. With the
// explicit value no tablet stops working on the deployment; the school admins
// see a notice until they choose a PIN that is not easy to guess. Each value
// is recorded in the settings audit as a system change, redacted like every
// password setting.
func devicePINKeepsFormerDefaultUp(ctx context.Context, db *bun.DB) error {
	tx, err := db.BeginTx(ctx, &sql.TxOptions{})
	if err != nil {
		return fmt.Errorf("begin device PIN migration: %w", err)
	}
	defer func() {
		if err := tx.Rollback(); err != nil && err.Error() != "sql: transaction has already been committed or rolled back" {
			logRollbackFailure(ctx, err)
		}
	}()

	if _, err := tx.ExecContext(ctx, `
		WITH kept AS (
			INSERT INTO config.setting_values (tenant_id, setting_key, value)
			SELECT s.id, 'security.ogs_device_pin', '"1234"'::jsonb
			FROM platform.schools s
			WHERE NOT EXISTS (
				SELECT 1 FROM config.setting_values nfc
				WHERE nfc.tenant_id = s.id
				  AND nfc.setting_key = 'module.nfc_anwesenheit'
				  AND nfc.value = 'false'::jsonb
			)
			ON CONFLICT (tenant_id, setting_key) DO NOTHING
			RETURNING tenant_id, setting_key
		)
		INSERT INTO config.setting_audit (tenant_id, setting_key, old_value, new_value, action, changed_by)
		SELECT tenant_id, setting_key, NULL, '"[REDACTED]"'::jsonb, 'set', NULL
		FROM kept;
	`); err != nil {
		return fmt.Errorf("keep the former device PIN default: %w", err)
	}

	return tx.Commit()
}

// devicePINKeepsFormerDefaultDown keeps the explicit values. The previous
// code accepts them just like its registry default 1234, and the migration
// cannot distinguish an inserted value from a school's pre-existing choice.
func devicePINKeepsFormerDefaultDown(context.Context, *bun.DB) error {
	return nil
}
