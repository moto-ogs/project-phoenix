package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

const parentBillingNumberRangeStartsVersion = "20261118071714"

func init() {
	MigrationRegistry.Register(&Migration{
		Version:     parentBillingNumberRangeStartsVersion,
		Description: "Elternabrechnung: Startwert je Nummernkreis mit Verlauf (#7358)",
		DependsOn: []string{
			parentBillingExportFilesVersion, // the counters with the check of the export files (1.15.875)
		},
	})
	Migrations.MustRegister(parentBillingNumberRangeStartsUp, parentBillingNumberRangeStartsDown)
}

// parentBillingNumberRangeStartsUpSQL lets a Träger continue the invoice
// numbers of the program it used before (#7358, ADR 0119 addendum
// 2026-11-17).
//
//   - number_range_counters.start_number is the number the next invoice of
//     the counter gets at least. The release takes the larger of it and the
//     number after the last issued one, in the statement that holds the
//     counter row, so a start value never moves a number back and a release
//     that waits for a start value sees it. A counter may now exist before
//     its first invoice, with last_number 0.
//   - parent_billing.number_range_starts is the history: every start value
//     the Abrechnung set for the counter of a service and year (0 for a
//     pattern without a year), who set it and when. Rows are only added.
//
// The table carries organization_id and the Träger policy of ADR 0105 and
// goes with its Träger. The request role may only read and add.
const parentBillingNumberRangeStartsUpSQL = `
ALTER TABLE parent_billing.number_range_counters
	ADD COLUMN start_number BIGINT,
	ADD CONSTRAINT chk_number_range_counters_start CHECK (start_number BETWEEN 1 AND 99999999),
	DROP CONSTRAINT chk_number_range_counters_last,
	ADD CONSTRAINT chk_number_range_counters_last CHECK (last_number >= 0);
COMMENT ON COLUMN parent_billing.number_range_counters.start_number IS
	'Number the next invoice of the counter gets at least (#7358); the release takes the larger of it and last_number + 1.';

CREATE TABLE parent_billing.number_range_starts (
	id BIGSERIAL PRIMARY KEY,
	organization_id BIGINT NOT NULL REFERENCES platform.organizations(id) ON DELETE CASCADE,
	service VARCHAR(16) NOT NULL,
	year SMALLINT NOT NULL,
	next_number BIGINT NOT NULL,
	actor_account_id BIGINT REFERENCES auth.accounts(id) ON DELETE SET NULL,
	occurred_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT chk_number_range_starts_service CHECK (service IN ('holiday', 'care')),
	CONSTRAINT chk_number_range_starts_year CHECK (year = 0 OR year BETWEEN 2000 AND 2999),
	CONSTRAINT chk_number_range_starts_next CHECK (next_number BETWEEN 1 AND 99999999)
);
CREATE INDEX idx_number_range_starts_counter
	ON parent_billing.number_range_starts (organization_id, service, year, id DESC);
COMMENT ON TABLE parent_billing.number_range_starts IS
	'History of the start values of the invoice numbers of a Träger per service and year (#7358, ADR 0119): value, account and time; only added.';

ALTER TABLE parent_billing.number_range_starts ENABLE ROW LEVEL SECURITY;
ALTER TABLE parent_billing.number_range_starts FORCE ROW LEVEL SECURITY;
CREATE POLICY traeger_isolation_parent_billing_number_range_starts ON parent_billing.number_range_starts FOR ALL
	USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::bigint)
	WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::bigint);

REVOKE ALL ON parent_billing.number_range_starts FROM PUBLIC;
GRANT SELECT, INSERT ON parent_billing.number_range_starts TO phoenix_tenant;
GRANT USAGE ON SEQUENCE parent_billing.number_range_starts_id_seq TO phoenix_tenant;
GRANT ALL ON parent_billing.number_range_starts TO phoenix_admin;
GRANT ALL ON SEQUENCE parent_billing.number_range_starts_id_seq TO phoenix_admin;
`

// The Down drops the counters that only hold a start value: without the
// column they would name a last number that was never issued.
const parentBillingNumberRangeStartsDownSQL = `
DROP TABLE IF EXISTS parent_billing.number_range_starts;
DELETE FROM parent_billing.number_range_counters WHERE last_number = 0 AND service <> 'export';
ALTER TABLE parent_billing.number_range_counters
	DROP CONSTRAINT chk_number_range_counters_start,
	DROP COLUMN start_number,
	DROP CONSTRAINT chk_number_range_counters_last,
	ADD CONSTRAINT chk_number_range_counters_last CHECK (last_number >= 1 OR (service = 'export' AND year = 0 AND last_number >= 0));
`

func parentBillingNumberRangeStartsUp(ctx context.Context, db *bun.DB) error {
	if _, err := db.ExecContext(ctx, parentBillingNumberRangeStartsUpSQL); err != nil {
		return fmt.Errorf("create the start values of the number ranges: %w", err)
	}
	return nil
}

func parentBillingNumberRangeStartsDown(ctx context.Context, db *bun.DB) error {
	if _, err := db.ExecContext(ctx, parentBillingNumberRangeStartsDownSQL); err != nil {
		return fmt.Errorf("drop the start values of the number ranges: %w", err)
	}
	return nil
}
