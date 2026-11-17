package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

const parentBillingNumberRangeStartsVersion = "20261117222315"

func init() {
	MigrationRegistry.Register(&Migration{
		Version:     parentBillingNumberRangeStartsVersion,
		Description: "Elternabrechnung: Startwert je Nummernkreis mit Verlauf (#7358)",
		DependsOn: []string{
			parentBillingCareMonthsVersion, // the number ranges of both services (1.15.789)
		},
	})
	Migrations.MustRegister(parentBillingNumberRangeStartsUp, parentBillingNumberRangeStartsDown)
}

// parentBillingNumberRangeStartsUpSQL lets a Träger continue the invoice
// numbers of the program it used before (#7358, ADR 0119 addendum
// 2026-11-17).
//
// parent_billing.number_range_starts holds every start value the
// Abrechnung set for the counter of a service and year (0 for a pattern
// without a year): the number the next invoice gets, who set it and when.
// Rows are only added. The newest row of a counter is its floor: the release
// of a run takes the larger of the floor and the last issued number
// (parent_billing.number_range_counters, which keeps its meaning), so a
// start value never moves a number back. The older rows are the history.
//
// The table carries organization_id and the Träger policy of ADR 0105 and
// goes with its Träger. The request role may only read and add.
const parentBillingNumberRangeStartsUpSQL = `
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
	'Start values of the invoice numbers of a Träger per service and year (#7358, ADR 0119): the newest is the floor of the counter, the older ones its history; only added.';

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

const parentBillingNumberRangeStartsDownSQL = `
DROP TABLE IF EXISTS parent_billing.number_range_starts;
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
