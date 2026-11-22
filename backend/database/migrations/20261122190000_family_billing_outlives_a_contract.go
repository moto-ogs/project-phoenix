package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

const familyBillingOutlivesAContractVersion = "20261122190000"

func init() {
	MigrationRegistry.Register(&Migration{
		Version:     familyBillingOutlivesAContractVersion,
		Description: "Elternabrechnung: Abweichung der Familie geht mit ihrem letzten Vertrag (#7862)",
		DependsOn: []string{
			traegerStaffShiftSeriesVersion, // the last migration before this one
			familyDebtorNumberVersion,      // the comments this one restates
		},
	})
	Migrations.MustRegister(familyBillingOutlivesAContractUp, familyBillingOutlivesAContractDown)
}

// familyBillingOutlivesAContractUpSQL restates the retention of a family's
// deviation (#7862, ADR 0184 Nachtrag 2026-11-22). The schema stays: before
// the Beleg retention deletes a contract, the Elternabrechnung moves each
// deviation hanging on it with its trail onto the contract of the same family
// that stays longest, so the row goes with the family's last contract by the
// existing cascade.
const familyBillingOutlivesAContractUpSQL = `
COMMENT ON TABLE parent_billing.family_billing IS
	'Deviation and debtor number of one family (#4689, #6692), keyed by the mail address of the registration; hangs on a contract of the family, which the retention moves to another contract of the family before deleting it (#7862), so it goes with the family''s last contract unless a holiday registration used it (last_used_on), a row without a contract after its own period.';
COMMENT ON COLUMN parent_billing.family_billing.care_contract_id IS
	'A contract of the family the deviation hangs on; the retention moves it to the family''s contract that stays longest before deleting it (#7862). NULL for a family the holiday care knows only (#6692), whose row keeps its debtor number.';
COMMENT ON TABLE parent_billing.family_billing_events IS
	'Trail of every read and change of a family deviation or debtor number (#4689, #6692): which one, who and when; no names. Moves with its row to another contract of the family (#7862) and goes with the last, without one after its row and three years.';
`

const familyBillingOutlivesAContractDownSQL = `
COMMENT ON TABLE parent_billing.family_billing IS
	'Deviation and debtor number of one family (#4689, #6692), keyed by the mail address of the registration; goes with the contract it was set from unless a holiday registration used it (last_used_on), a row without a contract after its own period.';
COMMENT ON COLUMN parent_billing.family_billing.care_contract_id IS
	'Contract the deviation was set from; NULL for a family the holiday care knows only (#6692), whose row keeps its debtor number.';
COMMENT ON TABLE parent_billing.family_billing_events IS
	'Trail of every read and change of a family deviation or debtor number (#4689, #6692): which one, who and when; no names. Goes with its contract, without one after its row and three years.';
`

func familyBillingOutlivesAContractUp(ctx context.Context, db *bun.DB) error {
	if _, err := db.ExecContext(ctx, familyBillingOutlivesAContractUpSQL); err != nil {
		return fmt.Errorf("restate the retention of the family deviation: %w", err)
	}
	return nil
}

func familyBillingOutlivesAContractDown(ctx context.Context, db *bun.DB) error {
	if _, err := db.ExecContext(ctx, familyBillingOutlivesAContractDownSQL); err != nil {
		return fmt.Errorf("restore the retention comments of the family deviation: %w", err)
	}
	return nil
}
