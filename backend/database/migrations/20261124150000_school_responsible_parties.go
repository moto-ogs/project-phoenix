package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

const schoolResponsiblePartiesVersion = "20261124150000"

func init() {
	MigrationRegistry.Register(&Migration{
		Version:     schoolResponsiblePartiesVersion,
		Description: "Träger-Portal: Schulträger und Gemeinde je Schule als zuständige Stellen mit Anschrift, Ansprechperson und Bankverbindung (#4811)",
		DependsOn: []string{
			traegerReportTemplatesVersion, // the master data log whose subjects this one extends
		},
	})
	Migrations.MustRegister(schoolResponsiblePartiesUp, schoolResponsiblePartiesDown)
}

// schoolResponsiblePartiesUpSQL adds the bodies besides the Träger that may
// be responsible at a school (#4811, ADR 0088):
//
//   - platform.school_responsible_parties: per school of a Träger at most
//     one Schulträger and one Gemeinde, each with name, address, contact
//     person and, for billing, the SEPA creditor identifier and a bank
//     account. Which body is responsible for contracts, billing and staff
//     is a setting (responsibility.*, ADR 0086); a body without a row here
//     cannot stand on a document, so the Träger stays responsible.
//     Like parent_billing.care_tariffs the row names its school without a
//     foreign key: it belongs to the Träger, follows the Träger policy of
//     ADR 0105 and goes with the Träger. The Träger-Büro removes it in the
//     Träger-Portal.
//   - platform.traeger_master_data_audit admits the subject 'school_party'.
const schoolResponsiblePartiesUpSQL = `
CREATE TABLE platform.school_responsible_parties (
	id BIGSERIAL PRIMARY KEY,
	organization_id BIGINT NOT NULL REFERENCES platform.organizations(id) ON DELETE CASCADE,
	school_id BIGINT NOT NULL,
	kind VARCHAR(16) NOT NULL,
	name TEXT NOT NULL,
	street TEXT NOT NULL,
	postal_code VARCHAR(10) NOT NULL,
	city TEXT NOT NULL,
	contact_name TEXT NOT NULL DEFAULT '',
	contact_phone TEXT NOT NULL DEFAULT '',
	contact_email TEXT NOT NULL DEFAULT '',
	creditor_id VARCHAR(35) NOT NULL DEFAULT '',
	account_holder TEXT NOT NULL DEFAULT '',
	iban VARCHAR(34) NOT NULL DEFAULT '',
	bic VARCHAR(11) NOT NULL DEFAULT '',
	bank_name TEXT NOT NULL DEFAULT '',
	created_by BIGINT REFERENCES auth.accounts(id) ON DELETE SET NULL,
	updated_by BIGINT REFERENCES auth.accounts(id) ON DELETE SET NULL,
	created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT uq_school_responsible_parties_kind UNIQUE (organization_id, school_id, kind),
	CONSTRAINT chk_school_responsible_parties_kind CHECK (kind IN ('schultraeger', 'gemeinde')),
	CONSTRAINT chk_school_responsible_parties_name CHECK (BTRIM(name) = name AND char_length(name) BETWEEN 1 AND 140),
	CONSTRAINT chk_school_responsible_parties_address CHECK (
		BTRIM(street) = street AND char_length(street) BETWEEN 1 AND 140
		AND postal_code ~ '^[0-9]{5}$'
		AND BTRIM(city) = city AND char_length(city) BETWEEN 1 AND 120
	),
	CONSTRAINT chk_school_responsible_parties_contact CHECK (
		char_length(contact_name) <= 120 AND char_length(contact_phone) <= 40 AND char_length(contact_email) <= 254
	),
	CONSTRAINT chk_school_responsible_parties_creditor CHECK (
		creditor_id = '' OR creditor_id ~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{3}[A-Z0-9]{1,28}$'
	),
	CONSTRAINT chk_school_responsible_parties_account CHECK (
		(iban = '' AND account_holder = '' AND bic = '' AND bank_name = '')
		OR (iban ~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$' AND BTRIM(account_holder) <> '' AND char_length(account_holder) <= 140
			AND (bic = '' OR bic ~ '^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$') AND char_length(bank_name) <= 120)
	)
);
COMMENT ON TABLE platform.school_responsible_parties IS
	'Schulträger or Gemeinde of a school of a Träger (#4811): name, address, contact person, SEPA creditor identifier and bank account of the body the settings responsibility.* may name; read and written in the Träger transaction (ADR 0105).';

CREATE TRIGGER update_platform_school_responsible_parties_updated_at
	BEFORE UPDATE ON platform.school_responsible_parties
	FOR EACH ROW EXECUTE FUNCTION update_modified_column();

ALTER TABLE platform.school_responsible_parties ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.school_responsible_parties FORCE ROW LEVEL SECURITY;
CREATE POLICY traeger_isolation_platform_school_responsible_parties ON platform.school_responsible_parties FOR ALL
	USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::bigint)
	WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::bigint);

REVOKE ALL ON platform.school_responsible_parties FROM PUBLIC, phoenix_auth;
GRANT SELECT, INSERT, UPDATE, DELETE ON platform.school_responsible_parties TO phoenix_tenant;
GRANT USAGE ON SEQUENCE platform.school_responsible_parties_id_seq TO phoenix_tenant;
GRANT ALL ON platform.school_responsible_parties TO phoenix_admin;
GRANT USAGE ON SEQUENCE platform.school_responsible_parties_id_seq TO phoenix_admin;

ALTER TABLE platform.traeger_master_data_audit DROP CONSTRAINT chk_traeger_master_data_audit_subject;
ALTER TABLE platform.traeger_master_data_audit ADD CONSTRAINT chk_traeger_master_data_audit_subject
	CHECK (subject IN ('master_data', 'contact', 'logo', 'bank_account', 'template', 'withdrawal', 'report_template', 'school_party'));
`

const schoolResponsiblePartiesDownSQL = `
DELETE FROM platform.traeger_master_data_audit WHERE subject = 'school_party';
ALTER TABLE platform.traeger_master_data_audit DROP CONSTRAINT chk_traeger_master_data_audit_subject;
ALTER TABLE platform.traeger_master_data_audit ADD CONSTRAINT chk_traeger_master_data_audit_subject
	CHECK (subject IN ('master_data', 'contact', 'logo', 'bank_account', 'template', 'withdrawal', 'report_template'));
DROP TABLE IF EXISTS platform.school_responsible_parties;
`

func schoolResponsiblePartiesUp(ctx context.Context, db *bun.DB) error {
	if _, err := db.ExecContext(ctx, schoolResponsiblePartiesUpSQL); err != nil {
		return fmt.Errorf("create school responsible parties: %w", err)
	}
	return nil
}

func schoolResponsiblePartiesDown(ctx context.Context, db *bun.DB) error {
	if _, err := db.ExecContext(ctx, schoolResponsiblePartiesDownSQL); err != nil {
		return fmt.Errorf("drop school responsible parties: %w", err)
	}
	return nil
}
