package migrations

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/uptrace/bun"
)

const traegerStaffContractsVersion = "20261114234500"

func init() {
	MigrationRegistry.Register(&Migration{
		Version:     traegerStaffContractsVersion,
		Description: "Arbeitsverträge mit Soll je Einsatzort und Ferien-Soll je Woche in der Personalakte des Trägers (#4706, ADR 0089)",
		DependsOn: []string{
			traegerStaffRecordsVersion,         // the record a contract belongs to (#4705)
			staffTargetOverrideWeekdaysVersion, // weekday_minutes on config.staff_target_overrides (#3745)
		},
	})
	Migrations.MustRegister(traegerStaffContractsUp, traegerStaffContractsDown)
}

// traegerStaffContractsUpSQL creates the Arbeitsvertrag of ADR 0089 section 1
// (#4706).
//
//   - workforce.staff_contracts is one contract of a record: its kind, its
//     first and, once known, its last day. A record may hold several, one
//     after another or side by side; one Einsatzort belongs to at most one
//     contract on any day.
//   - workforce.staff_contract_targets is the Soll of a contract at one
//     Einsatzort from a day on, Monday to Friday in minutes. A change of the
//     Soll is a new row from its first day, so the record keeps the history.
//   - workforce.staff_contract_holiday_weeks is the Ferien-Soll of one
//     holiday week (Monday) at one Einsatzort, Monday to Friday in minutes.
//
// Workforce mirrors both into the school's time tracking: the Soll into
// config.staff_work_schedules, a holiday week into a Sonderarbeitszeit
// (config.staff_target_overrides) that names the contract in
// traeger_contract_id. Like the links, the tables name the school and the
// employment by plain ids (ADR 0233 section 3). A school reads the contract,
// the Soll and the holiday weeks of its own employments only, so it can show
// „führt der Träger“; it writes none of them.
const traegerStaffContractsUpSQL = `
CREATE TABLE workforce.staff_contracts (
	id BIGSERIAL PRIMARY KEY,
	organization_id BIGINT NOT NULL,
	staff_record_id BIGINT NOT NULL,
	kind VARCHAR(16) NOT NULL CONSTRAINT chk_workforce_staff_contracts_kind CHECK (kind IN ('full_time', 'part_time', 'minijob')),
	starts_on DATE NOT NULL,
	ends_on DATE,
	created_by_account_id BIGINT NOT NULL,
	created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
	updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
	CONSTRAINT uq_workforce_staff_contracts_organization_id UNIQUE (organization_id, id),
	CONSTRAINT fk_workforce_staff_contracts_record FOREIGN KEY (organization_id, staff_record_id)
		REFERENCES workforce.staff_records (organization_id, id) ON DELETE CASCADE,
	CONSTRAINT chk_workforce_staff_contracts_dates CHECK (ends_on IS NULL OR ends_on >= starts_on)
);
CREATE INDEX idx_workforce_staff_contracts_record ON workforce.staff_contracts (organization_id, staff_record_id);
COMMENT ON TABLE workforce.staff_contracts IS
	'Arbeitsvertrag of a Personalstamm (ADR 0089 section 1, #4706): kind, first and last day.';

CREATE TABLE workforce.staff_contract_targets (
	id BIGSERIAL PRIMARY KEY,
	organization_id BIGINT NOT NULL,
	contract_id BIGINT NOT NULL,
	school_id BIGINT NOT NULL,
	membership_id BIGINT NOT NULL,
	valid_from DATE NOT NULL,
	weekday_minutes INTEGER[] NOT NULL,
	created_by_account_id BIGINT NOT NULL,
	created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
	CONSTRAINT fk_workforce_staff_contract_targets_contract FOREIGN KEY (organization_id, contract_id)
		REFERENCES workforce.staff_contracts (organization_id, id) ON DELETE CASCADE,
	CONSTRAINT uq_workforce_staff_contract_targets_version UNIQUE (contract_id, school_id, valid_from),
	CONSTRAINT chk_workforce_staff_contract_targets_minutes CHECK (
		array_ndims(weekday_minutes) = 1 AND cardinality(weekday_minutes) = 5
		AND array_position(weekday_minutes, NULL) IS NULL
		AND 0 <= ALL(weekday_minutes) AND 720 >= ALL(weekday_minutes))
);
CREATE INDEX idx_workforce_staff_contract_targets_school ON workforce.staff_contract_targets (school_id, membership_id);
COMMENT ON TABLE workforce.staff_contract_targets IS
	'Soll of an Arbeitsvertrag at one Einsatzort from valid_from on, Monday to Friday in minutes (#4706).';

CREATE TABLE workforce.staff_contract_holiday_weeks (
	id BIGSERIAL PRIMARY KEY,
	organization_id BIGINT NOT NULL,
	contract_id BIGINT NOT NULL,
	school_id BIGINT NOT NULL,
	membership_id BIGINT NOT NULL,
	week_start DATE NOT NULL,
	weekday_minutes INTEGER[] NOT NULL,
	created_by_account_id BIGINT NOT NULL,
	created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
	CONSTRAINT fk_workforce_staff_contract_holiday_weeks_contract FOREIGN KEY (organization_id, contract_id)
		REFERENCES workforce.staff_contracts (organization_id, id) ON DELETE CASCADE,
	CONSTRAINT uq_workforce_staff_contract_holiday_weeks_week UNIQUE (contract_id, school_id, week_start),
	CONSTRAINT chk_workforce_staff_contract_holiday_weeks_monday CHECK (EXTRACT(ISODOW FROM week_start) = 1),
	CONSTRAINT chk_workforce_staff_contract_holiday_weeks_minutes CHECK (
		array_ndims(weekday_minutes) = 1 AND cardinality(weekday_minutes) = 5
		AND array_position(weekday_minutes, NULL) IS NULL
		AND 0 <= ALL(weekday_minutes) AND 720 >= ALL(weekday_minutes))
);
CREATE INDEX idx_workforce_staff_contract_holiday_weeks_school ON workforce.staff_contract_holiday_weeks (school_id, membership_id);
COMMENT ON TABLE workforce.staff_contract_holiday_weeks IS
	'Ferien-Soll of an Arbeitsvertrag for one holiday week at one Einsatzort, Monday to Friday in minutes (#4706).';

CREATE TRIGGER trg_workforce_staff_contracts_updated_at BEFORE UPDATE ON workforce.staff_contracts
	FOR EACH ROW EXECUTE FUNCTION update_modified_column();

ALTER TABLE workforce.staff_contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE workforce.staff_contracts FORCE ROW LEVEL SECURITY;
CREATE POLICY traeger_isolation_workforce_staff_contracts ON workforce.staff_contracts FOR ALL
	USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::bigint)
	WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::bigint);

ALTER TABLE workforce.staff_contract_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE workforce.staff_contract_targets FORCE ROW LEVEL SECURITY;
CREATE POLICY traeger_isolation_workforce_staff_contract_targets ON workforce.staff_contract_targets FOR ALL
	USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::bigint)
	WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::bigint);

ALTER TABLE workforce.staff_contract_holiday_weeks ENABLE ROW LEVEL SECURITY;
ALTER TABLE workforce.staff_contract_holiday_weeks FORCE ROW LEVEL SECURITY;
CREATE POLICY traeger_isolation_workforce_staff_contract_holiday_weeks ON workforce.staff_contract_holiday_weeks FOR ALL
	USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::bigint)
	WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::bigint);

-- A school reads the Soll of its own employments and the contracts behind
-- them (ADR 0089 section 6: kind and Soll at its Einsatzort), never the Soll
-- another school gets.
CREATE POLICY school_reads_workforce_staff_contract_targets ON workforce.staff_contract_targets FOR SELECT
	USING (school_id = NULLIF(current_setting('app.current_tenant_id', true), '')::bigint);
CREATE POLICY school_reads_workforce_staff_contract_holiday_weeks ON workforce.staff_contract_holiday_weeks FOR SELECT
	USING (school_id = NULLIF(current_setting('app.current_tenant_id', true), '')::bigint);
CREATE POLICY school_reads_workforce_staff_contracts ON workforce.staff_contracts FOR SELECT
	USING (EXISTS (
		SELECT FROM workforce.staff_contract_targets AS target
		WHERE target.contract_id = staff_contracts.id
		  AND target.school_id = NULLIF(current_setting('app.current_tenant_id', true), '')::bigint));

-- A Sonderarbeitszeit the Träger writes for a holiday week names its
-- contract (plain id, like the other Träger references), so the next mirror
-- replaces it and the school sees it as „vom Träger“.
ALTER TABLE config.staff_target_overrides ADD COLUMN traeger_contract_id BIGINT;

-- The trail of a record also lists contract changes.
ALTER TABLE workforce.staff_record_changes DROP CONSTRAINT chk_workforce_staff_record_changes_kind;
ALTER TABLE workforce.staff_record_changes ADD CONSTRAINT chk_workforce_staff_record_changes_kind
	CHECK (kind IN ('linked', 'not_chosen', 'changed', 'added', 'removed'));
ALTER TABLE workforce.staff_record_changes DROP CONSTRAINT chk_workforce_staff_record_changes_field;
ALTER TABLE workforce.staff_record_changes ADD CONSTRAINT chk_workforce_staff_record_changes_field CHECK (field IN (
	'school', 'first_name', 'last_name', 'birthday', 'personnel_number', 'iban', 'tax_id', 'social_security_number',
	'contract', 'contract_soll', 'holiday_week'));

REVOKE ALL ON workforce.staff_contracts, workforce.staff_contract_targets, workforce.staff_contract_holiday_weeks FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON workforce.staff_contracts, workforce.staff_contract_targets, workforce.staff_contract_holiday_weeks TO phoenix_tenant;
GRANT USAGE ON SEQUENCE workforce.staff_contracts_id_seq, workforce.staff_contract_targets_id_seq, workforce.staff_contract_holiday_weeks_id_seq TO phoenix_tenant;
GRANT ALL ON workforce.staff_contracts, workforce.staff_contract_targets, workforce.staff_contract_holiday_weeks TO phoenix_admin;
GRANT USAGE ON SEQUENCE workforce.staff_contracts_id_seq, workforce.staff_contract_targets_id_seq, workforce.staff_contract_holiday_weeks_id_seq TO phoenix_admin;
`

const traegerStaffContractsDownSQL = `
DELETE FROM workforce.staff_record_changes WHERE kind IN ('added', 'removed') OR field IN ('contract', 'contract_soll', 'holiday_week');
ALTER TABLE workforce.staff_record_changes DROP CONSTRAINT chk_workforce_staff_record_changes_field;
ALTER TABLE workforce.staff_record_changes ADD CONSTRAINT chk_workforce_staff_record_changes_field CHECK (field IN (
	'school', 'first_name', 'last_name', 'birthday', 'personnel_number', 'iban', 'tax_id', 'social_security_number'));
ALTER TABLE workforce.staff_record_changes DROP CONSTRAINT chk_workforce_staff_record_changes_kind;
ALTER TABLE workforce.staff_record_changes ADD CONSTRAINT chk_workforce_staff_record_changes_kind
	CHECK (kind IN ('linked', 'not_chosen', 'changed'));
ALTER TABLE config.staff_target_overrides DROP COLUMN IF EXISTS traeger_contract_id;
DROP TABLE IF EXISTS workforce.staff_contract_holiday_weeks;
DROP TABLE IF EXISTS workforce.staff_contract_targets;
DROP TABLE IF EXISTS workforce.staff_contracts;
`

func traegerStaffContractsUp(ctx context.Context, db *bun.DB) error {
	return db.RunInTx(ctx, &sql.TxOptions{}, func(ctx context.Context, tx bun.Tx) error {
		if _, err := tx.ExecContext(ctx, traegerStaffContractsUpSQL); err != nil {
			return fmt.Errorf("create traeger staff contracts: %w", err)
		}
		return nil
	})
}

func traegerStaffContractsDown(ctx context.Context, db *bun.DB) error {
	return db.RunInTx(ctx, &sql.TxOptions{}, func(ctx context.Context, tx bun.Tx) error {
		if _, err := tx.ExecContext(ctx, traegerStaffContractsDownSQL); err != nil {
			return fmt.Errorf("drop traeger staff contracts: %w", err)
		}
		return nil
	})
}
