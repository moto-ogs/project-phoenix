package migrations

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/uptrace/bun"
)

const traegerStaffImportTrailVersion = "20261115130000"

func init() {
	MigrationRegistry.Register(&Migration{
		Version:     traegerStaffImportTrailVersion,
		Description: "Verlauf der Personalakte nennt den Personal-Import mit Datei und Zeile (#4724, ADR 0089 §5)",
		DependsOn: []string{
			traegerStaffContractsVersion, // the last shape of the trail's kind and field constraints (#4706)
		},
	})
	Migrations.MustRegister(traegerStaffImportTrailUp, traegerStaffImportTrailDown)
}

// traegerStaffImportTrailUpSQL lets the trail of a Personalstamm name the
// Personal-Import (#4724): kind 'imported' with field 'record' for a record
// the import created, or with a bank or tax field for a value it filled in.
// The text keeps the line and the name of the file; the file itself is never
// stored. The import log of the Träger-Portal reads these entries.
const traegerStaffImportTrailUpSQL = `
ALTER TABLE workforce.staff_record_changes DROP CONSTRAINT chk_workforce_staff_record_changes_kind;
ALTER TABLE workforce.staff_record_changes ADD CONSTRAINT chk_workforce_staff_record_changes_kind
	CHECK (kind IN ('linked', 'not_chosen', 'changed', 'added', 'removed', 'imported'));
ALTER TABLE workforce.staff_record_changes DROP CONSTRAINT chk_workforce_staff_record_changes_field;
ALTER TABLE workforce.staff_record_changes ADD CONSTRAINT chk_workforce_staff_record_changes_field CHECK (field IN (
	'school', 'first_name', 'last_name', 'birthday', 'personnel_number', 'iban', 'tax_id', 'social_security_number',
	'contract', 'contract_soll', 'holiday_week', 'record'));
CREATE INDEX idx_workforce_staff_record_changes_imports ON workforce.staff_record_changes (organization_id, occurred_at DESC)
	WHERE kind = 'imported';
`

const traegerStaffImportTrailDownSQL = `
DROP INDEX IF EXISTS workforce.idx_workforce_staff_record_changes_imports;
DELETE FROM workforce.staff_record_changes WHERE kind = 'imported' OR field = 'record';
ALTER TABLE workforce.staff_record_changes DROP CONSTRAINT chk_workforce_staff_record_changes_field;
ALTER TABLE workforce.staff_record_changes ADD CONSTRAINT chk_workforce_staff_record_changes_field CHECK (field IN (
	'school', 'first_name', 'last_name', 'birthday', 'personnel_number', 'iban', 'tax_id', 'social_security_number',
	'contract', 'contract_soll', 'holiday_week'));
ALTER TABLE workforce.staff_record_changes DROP CONSTRAINT chk_workforce_staff_record_changes_kind;
ALTER TABLE workforce.staff_record_changes ADD CONSTRAINT chk_workforce_staff_record_changes_kind
	CHECK (kind IN ('linked', 'not_chosen', 'changed', 'added', 'removed'));
`

func traegerStaffImportTrailUp(ctx context.Context, db *bun.DB) error {
	return db.RunInTx(ctx, &sql.TxOptions{}, func(ctx context.Context, tx bun.Tx) error {
		if _, err := tx.ExecContext(ctx, traegerStaffImportTrailUpSQL); err != nil {
			return fmt.Errorf("extend traeger staff trail for imports: %w", err)
		}
		return nil
	})
}

func traegerStaffImportTrailDown(ctx context.Context, db *bun.DB) error {
	return db.RunInTx(ctx, &sql.TxOptions{}, func(ctx context.Context, tx bun.Tx) error {
		if _, err := tx.ExecContext(ctx, traegerStaffImportTrailDownSQL); err != nil {
			return fmt.Errorf("restore traeger staff trail: %w", err)
		}
		return nil
	})
}
