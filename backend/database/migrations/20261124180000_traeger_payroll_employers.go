package migrations

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/uptrace/bun"
)

const traegerPayrollEmployersVersion = "20261124180000"

func init() {
	MigrationRegistry.Register(&Migration{
		Version:     traegerPayrollEmployersVersion,
		Description: "Lohnexport je Arbeitgeber: DATEV-Nummern und Kostenstelle von Schulträger und Gemeinde, Personalnummer je Arbeitgeber am Einsatzort (#8041, ADR 0319)",
		DependsOn: []string{
			traegerStaffImportTrailVersion, // the last shape of the trail's field constraint
			springerEmploymentEndVersion,   // the last shape of the Einsatzorte
		},
	})
	Migrations.MustRegister(traegerPayrollEmployersUp, traegerPayrollEmployersDown)
}

// traegerPayrollEmployersUpSQL adds what the Träger's payroll file needs for
// an employer besides the Träger (#8041, ADR 0319):
//
//   - workforce.payroll_employers: per school and body (Schulträger or
//     Gemeinde) the DATEV Berater- and Mandantennummer of the Lohn and the
//     Kostenstelle that marks its lines in the one file of the Träger. They
//     are payroll values like the settings traeger_payroll.*, kept by the
//     Personalverwaltung. Like the bodies themselves
//     (platform.school_responsible_parties) the row names its school
//     without a foreign key, follows the Träger policy of ADR 0105 and goes
//     with the Träger.
//   - workforce.staff_record_links.employer_body and
//     employer_personnel_number: the personnel number a person has with the
//     body that employs at this Einsatzort, when its Lohnbüro uses another
//     one than the Träger's. It holds only for that body.
//   - the trail of a record admits the field employer_personnel_number.
const traegerPayrollEmployersUpSQL = `
CREATE TABLE workforce.payroll_employers (
	id BIGSERIAL PRIMARY KEY,
	organization_id BIGINT NOT NULL REFERENCES platform.organizations(id) ON DELETE CASCADE,
	school_id BIGINT NOT NULL,
	body VARCHAR(16) NOT NULL,
	consultant_number VARCHAR(7) NOT NULL DEFAULT '',
	client_number VARCHAR(5) NOT NULL DEFAULT '',
	cost_center VARCHAR(8) NOT NULL DEFAULT '',
	updated_by BIGINT REFERENCES auth.accounts(id) ON DELETE SET NULL,
	created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT uq_workforce_payroll_employers_body UNIQUE (organization_id, school_id, body),
	CONSTRAINT chk_workforce_payroll_employers_body CHECK (body IN ('schultraeger', 'gemeinde')),
	CONSTRAINT chk_workforce_payroll_employers_numbers CHECK (
		consultant_number ~ '^([0-9]{1,7})?$' AND client_number ~ '^([0-9]{1,5})?$' AND cost_center ~ '^([0-9]{1,8})?$'
	)
);
COMMENT ON TABLE workforce.payroll_employers IS
	'Payroll values of a Schulträger or a Gemeinde that employs the staff of a school of a Träger (#8041, ADR 0319): DATEV Berater- and Mandantennummer of its own payroll file and the Kostenstelle of its lines in the one file of the Träger; read and written in the Träger transaction (ADR 0105).';

CREATE TRIGGER update_workforce_payroll_employers_updated_at
	BEFORE UPDATE ON workforce.payroll_employers
	FOR EACH ROW EXECUTE FUNCTION update_modified_column();

ALTER TABLE workforce.payroll_employers ENABLE ROW LEVEL SECURITY;
ALTER TABLE workforce.payroll_employers FORCE ROW LEVEL SECURITY;
CREATE POLICY traeger_isolation_workforce_payroll_employers ON workforce.payroll_employers FOR ALL
	USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::bigint)
	WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::bigint);

REVOKE ALL ON workforce.payroll_employers FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON workforce.payroll_employers TO phoenix_tenant;
GRANT USAGE ON SEQUENCE workforce.payroll_employers_id_seq TO phoenix_tenant;
GRANT ALL ON workforce.payroll_employers TO phoenix_admin;
GRANT USAGE ON SEQUENCE workforce.payroll_employers_id_seq TO phoenix_admin;

ALTER TABLE workforce.staff_record_links
	ADD COLUMN employer_body VARCHAR(16),
	ADD COLUMN employer_personnel_number VARCHAR(9),
	ADD CONSTRAINT chk_workforce_staff_record_links_employer_number CHECK (
		(employer_body IS NULL AND employer_personnel_number IS NULL)
		OR (employer_body IN ('schultraeger', 'gemeinde') AND employer_personnel_number ~ '^[0-9]{1,9}$')
	);
COMMENT ON COLUMN workforce.staff_record_links.employer_personnel_number IS
	'Personnel number of the person with employer_body, the body that employs at this Einsatzort, when its Lohnbüro uses another number than the Träger (#8041, ADR 0319); the file per employer books it.';

ALTER TABLE workforce.staff_record_changes DROP CONSTRAINT chk_workforce_staff_record_changes_field;
ALTER TABLE workforce.staff_record_changes ADD CONSTRAINT chk_workforce_staff_record_changes_field CHECK (field IN (
	'school', 'first_name', 'last_name', 'birthday', 'personnel_number', 'iban', 'tax_id', 'social_security_number',
	'contract', 'contract_soll', 'holiday_week', 'record', 'employer_personnel_number'));
`

const traegerPayrollEmployersDownSQL = `
DELETE FROM workforce.staff_record_changes WHERE field = 'employer_personnel_number';
ALTER TABLE workforce.staff_record_changes DROP CONSTRAINT chk_workforce_staff_record_changes_field;
ALTER TABLE workforce.staff_record_changes ADD CONSTRAINT chk_workforce_staff_record_changes_field CHECK (field IN (
	'school', 'first_name', 'last_name', 'birthday', 'personnel_number', 'iban', 'tax_id', 'social_security_number',
	'contract', 'contract_soll', 'holiday_week', 'record'));
ALTER TABLE workforce.staff_record_links
	DROP CONSTRAINT IF EXISTS chk_workforce_staff_record_links_employer_number,
	DROP COLUMN IF EXISTS employer_personnel_number,
	DROP COLUMN IF EXISTS employer_body;
DROP TABLE IF EXISTS workforce.payroll_employers;
`

func traegerPayrollEmployersUp(ctx context.Context, db *bun.DB) error {
	return db.RunInTx(ctx, &sql.TxOptions{}, func(ctx context.Context, tx bun.Tx) error {
		if _, err := tx.ExecContext(ctx, traegerPayrollEmployersUpSQL); err != nil {
			return fmt.Errorf("create payroll employers: %w", err)
		}
		return nil
	})
}

func traegerPayrollEmployersDown(ctx context.Context, db *bun.DB) error {
	return db.RunInTx(ctx, &sql.TxOptions{}, func(ctx context.Context, tx bun.Tx) error {
		if _, err := tx.ExecContext(ctx, traegerPayrollEmployersDownSQL); err != nil {
			return fmt.Errorf("drop payroll employers: %w", err)
		}
		return nil
	})
}
