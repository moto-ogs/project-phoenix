package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

const careRunHoldsBilledInvoicesVersion = "20261123091500"

func init() {
	MigrationRegistry.Register(&Migration{
		Version:     careRunHoldsBilledInvoicesVersion,
		Description: "Monatslauf: zurückgehaltene Kinder, deren Monat schon eine ausgestellte Rechnung abrechnet (#7892)",
		DependsOn: []string{
			parentBillingCareMonthsVersion, // parent_billing.care_run_holds
		},
	})
	Migrations.MustRegister(careRunHoldsBilledInvoicesUp, careRunHoldsBilledInvoicesDown)
}

// careRunHoldsBilledInvoicesUpSQL lets the snapshot of a release keep the
// children it held back because an issued invoice of the month already
// bills them (#7892, ADR 0158 Nachtrag "Schon abgerechnet je Kind"):
//
//   - reason gets already_billed (an issued invoice or Jahresbescheid of
//     another contract of the child bills days the run would bill again) and
//     meal_only_invoice (the issued invoice of the contract itself carries
//     only its Mensa and blocks its care).
//   - invoices keeps the issued documents the child was held for, as they
//     were at the release: number, kind, contract, school and run. It is
//     empty for a duplicate contract, which the rows so far are.
//
// Running it again changes nothing.
const careRunHoldsBilledInvoicesUpSQL = `
ALTER TABLE parent_billing.care_run_holds
	ADD COLUMN IF NOT EXISTS invoices JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE parent_billing.care_run_holds DROP CONSTRAINT IF EXISTS chk_care_run_holds_invoices;
ALTER TABLE parent_billing.care_run_holds ADD CONSTRAINT chk_care_run_holds_invoices
	CHECK (jsonb_typeof(invoices) = 'array');
ALTER TABLE parent_billing.care_run_holds DROP CONSTRAINT IF EXISTS chk_care_run_holds_reason;
ALTER TABLE parent_billing.care_run_holds ADD CONSTRAINT chk_care_run_holds_reason
	CHECK (reason IN ('duplicate_contract', 'already_billed', 'meal_only_invoice'));
COMMENT ON COLUMN parent_billing.care_run_holds.invoices IS
	'Issued invoices or Jahresbescheide that already billed the month of a held child, as at the release (#7892); empty for a duplicate contract.';
COMMENT ON TABLE parent_billing.care_run_holds IS
	'Snapshot of a child a release held back: its contracts with the modules and weekdays billed twice, or the issued invoices that already bill its month (#4684, #7892, ADR 0158 E5); never changes.';
`

// careRunHoldsBilledInvoicesDownSQL removes the holds of the new reasons,
// which the old list cannot keep, and the column.
const careRunHoldsBilledInvoicesDownSQL = `
DELETE FROM parent_billing.care_run_holds WHERE reason IN ('already_billed', 'meal_only_invoice');
ALTER TABLE parent_billing.care_run_holds DROP CONSTRAINT IF EXISTS chk_care_run_holds_reason;
ALTER TABLE parent_billing.care_run_holds ADD CONSTRAINT chk_care_run_holds_reason
	CHECK (reason IN ('duplicate_contract'));
ALTER TABLE parent_billing.care_run_holds DROP CONSTRAINT IF EXISTS chk_care_run_holds_invoices;
ALTER TABLE parent_billing.care_run_holds DROP COLUMN IF EXISTS invoices;
COMMENT ON TABLE parent_billing.care_run_holds IS
	'Snapshot of a child a release held back with its contracts and the modules and weekdays billed twice (#4684, ADR 0158 E5); never changes.';
`

func careRunHoldsBilledInvoicesUp(ctx context.Context, db *bun.DB) error {
	if _, err := db.ExecContext(ctx, careRunHoldsBilledInvoicesUpSQL); err != nil {
		return fmt.Errorf("keep the issued invoices of a held child in the snapshot of a release: %w", err)
	}
	return nil
}

func careRunHoldsBilledInvoicesDown(ctx context.Context, db *bun.DB) error {
	if _, err := db.ExecContext(ctx, careRunHoldsBilledInvoicesDownSQL); err != nil {
		return fmt.Errorf("drop the issued invoices of held children: %w", err)
	}
	return nil
}
