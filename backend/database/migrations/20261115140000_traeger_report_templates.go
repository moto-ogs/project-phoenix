package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

const traegerReportTemplatesVersion = "20261115140000"

func init() {
	MigrationRegistry.Register(&Migration{
		Version:     traegerReportTemplatesVersion,
		Description: "Träger-Portal: Berichtsvorlagen für Kommune und Jugendamt mit Stichtag und Sozialräumen (#4716, ADR 0246)",
		DependsOn: []string{
			traegerWithdrawalContactVersion, // the master data log whose subjects this one extends
		},
	})
	Migrations.MustRegister(traegerReportTemplatesUp, traegerReportTemplatesDown)
}

// traegerReportTemplatesUpSQL adds the report templates of a Träger (#4716,
// spec #4611 user stories 115 and 116, ADR 0246):
//
//   - platform.traeger_report_templates: a named template of the key-date
//     report the Träger-Büro hands to its Kommune or Jugendamt: the sections
//     it shows (children, staff, absences, demand, in that order), the key
//     date of the year (month and day, 29.02. allowed) and the Sozialraum of
//     each school of the Träger. A template names no person; created_by and
//     updated_by name the account of the Träger-Büro that wrote it. Like the
//     master data, the rows belong to the Träger, follow the Träger policy of
//     ADR 0105 and go with the Träger.
//   - platform.traeger_master_data_audit admits the subject
//     'report_template'.
const traegerReportTemplatesUpSQL = `
CREATE TABLE platform.traeger_report_templates (
	id BIGSERIAL PRIMARY KEY,
	organization_id BIGINT NOT NULL REFERENCES platform.organizations(id) ON DELETE CASCADE,
	name TEXT NOT NULL,
	sections TEXT[] NOT NULL,
	key_date_month SMALLINT NOT NULL,
	key_date_day SMALLINT NOT NULL,
	districts JSONB NOT NULL DEFAULT '[]'::jsonb,
	created_by BIGINT REFERENCES auth.accounts(id) ON DELETE SET NULL,
	updated_by BIGINT REFERENCES auth.accounts(id) ON DELETE SET NULL,
	created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT chk_traeger_report_templates_name CHECK (BTRIM(name) = name AND char_length(name) BETWEEN 1 AND 120),
	CONSTRAINT chk_traeger_report_templates_sections CHECK (
		cardinality(sections) BETWEEN 1 AND 4
		AND sections <@ ARRAY['children', 'staff', 'absences', 'demand']::text[]
	),
	CONSTRAINT chk_traeger_report_templates_key_date CHECK (
		key_date_month BETWEEN 1 AND 12
		AND key_date_day BETWEEN 1 AND CASE
			WHEN key_date_month = 2 THEN 29
			WHEN key_date_month IN (4, 6, 9, 11) THEN 30
			ELSE 31
		END
	),
	CONSTRAINT chk_traeger_report_templates_districts CHECK (jsonb_typeof(districts) = 'array')
);
CREATE UNIQUE INDEX uq_traeger_report_templates_name ON platform.traeger_report_templates (organization_id, lower(name));
COMMENT ON TABLE platform.traeger_report_templates IS
	'Report templates of a Träger for its Kommune and Jugendamt (#4716, ADR 0246): sections, key date and the Sozialraum of each school; read and written in the Träger transaction (ADR 0105).';

CREATE TRIGGER update_platform_traeger_report_templates_updated_at
	BEFORE UPDATE ON platform.traeger_report_templates
	FOR EACH ROW EXECUTE FUNCTION update_modified_column();

ALTER TABLE platform.traeger_report_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.traeger_report_templates FORCE ROW LEVEL SECURITY;
CREATE POLICY traeger_isolation_platform_traeger_report_templates ON platform.traeger_report_templates FOR ALL
	USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::bigint)
	WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::bigint);

REVOKE ALL ON platform.traeger_report_templates FROM PUBLIC, phoenix_auth;
GRANT SELECT, INSERT, UPDATE, DELETE ON platform.traeger_report_templates TO phoenix_tenant;
GRANT USAGE ON SEQUENCE platform.traeger_report_templates_id_seq TO phoenix_tenant;
GRANT ALL ON platform.traeger_report_templates TO phoenix_admin;
GRANT USAGE ON SEQUENCE platform.traeger_report_templates_id_seq TO phoenix_admin;

ALTER TABLE platform.traeger_master_data_audit DROP CONSTRAINT chk_traeger_master_data_audit_subject;
ALTER TABLE platform.traeger_master_data_audit ADD CONSTRAINT chk_traeger_master_data_audit_subject
	CHECK (subject IN ('master_data', 'contact', 'logo', 'bank_account', 'template', 'withdrawal', 'report_template'));
`

const traegerReportTemplatesDownSQL = `
DELETE FROM platform.traeger_master_data_audit WHERE subject = 'report_template';
ALTER TABLE platform.traeger_master_data_audit DROP CONSTRAINT chk_traeger_master_data_audit_subject;
ALTER TABLE platform.traeger_master_data_audit ADD CONSTRAINT chk_traeger_master_data_audit_subject
	CHECK (subject IN ('master_data', 'contact', 'logo', 'bank_account', 'template', 'withdrawal'));
DROP TABLE IF EXISTS platform.traeger_report_templates;
`

func traegerReportTemplatesUp(ctx context.Context, db *bun.DB) error {
	if _, err := db.ExecContext(ctx, traegerReportTemplatesUpSQL); err != nil {
		return fmt.Errorf("create Träger report templates: %w", err)
	}
	return nil
}

func traegerReportTemplatesDown(ctx context.Context, db *bun.DB) error {
	if _, err := db.ExecContext(ctx, traegerReportTemplatesDownSQL); err != nil {
		return fmt.Errorf("drop Träger report templates: %w", err)
	}
	return nil
}
