package migrations

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/uptrace/bun"
)

const traegerContractKindsVolunteerVersion = "20261116120000"

func init() {
	MigrationRegistry.Register(&Migration{
		Version:     traegerContractKindsVolunteerVersion,
		Description: "Arbeitsverträge des Trägers als Übungsleiter und Ehrenamt (#4712, ADR 0089 section 1)",
		DependsOn: []string{
			traegerStaffContractsVersion, // the contracts whose kinds grow (#4706)
		},
	})
	Migrations.MustRegister(traegerContractKindsVolunteerUp, traegerContractKindsVolunteerDown)
}

// traegerContractKindsVolunteerUpSQL adds the two kinds only the Träger
// knows (ADR 0089 section 1, Folgen): Übungsleiter for the
// Übungsleiterpauschale and Ehrenamt for the Ehrenamtspauschale. The Träger's
// payroll file books each kind with its own Lohnarten (#4712), so a Minijob
// and an Übungsleiter contract of one person stay apart. The school's
// employment kinds (users.staff_employment_profiles) stay unchanged.
const traegerContractKindsVolunteerUpSQL = `
ALTER TABLE workforce.staff_contracts DROP CONSTRAINT chk_workforce_staff_contracts_kind;
ALTER TABLE workforce.staff_contracts ADD CONSTRAINT chk_workforce_staff_contracts_kind
	CHECK (kind IN ('full_time', 'part_time', 'minijob', 'uebungsleiter', 'ehrenamt'));
`

// traegerContractKindsVolunteerDownSQL restores the three kinds. A contract
// with a new kind makes the check fail, so the rollback stops instead of
// deleting or rewriting a contract.
const traegerContractKindsVolunteerDownSQL = `
ALTER TABLE workforce.staff_contracts DROP CONSTRAINT chk_workforce_staff_contracts_kind;
ALTER TABLE workforce.staff_contracts ADD CONSTRAINT chk_workforce_staff_contracts_kind
	CHECK (kind IN ('full_time', 'part_time', 'minijob'));
`

func traegerContractKindsVolunteerUp(ctx context.Context, db *bun.DB) error {
	return db.RunInTx(ctx, &sql.TxOptions{}, func(ctx context.Context, tx bun.Tx) error {
		if _, err := tx.ExecContext(ctx, traegerContractKindsVolunteerUpSQL); err != nil {
			return fmt.Errorf("add traeger contract kinds: %w", err)
		}
		return nil
	})
}

func traegerContractKindsVolunteerDown(ctx context.Context, db *bun.DB) error {
	return db.RunInTx(ctx, &sql.TxOptions{}, func(ctx context.Context, tx bun.Tx) error {
		if _, err := tx.ExecContext(ctx, traegerContractKindsVolunteerDownSQL); err != nil {
			return fmt.Errorf("restore traeger contract kinds: %w", err)
		}
		return nil
	})
}
