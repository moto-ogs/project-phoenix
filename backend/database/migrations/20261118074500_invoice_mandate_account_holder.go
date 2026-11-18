package migrations

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/uptrace/bun"
)

const invoiceMandateAccountHolderVersion = "20261118074500"

func init() {
	MigrationRegistry.Register(&Migration{
		Version:     invoiceMandateAccountHolderVersion,
		Description: "Rechnungen halten den versiegelten Kontoinhaber der Lastschrift fest (#7359)",
		DependsOn:   []string{parentBillingSEPAMandatesVersion},
	})
	Migrations.MustRegister(invoiceMandateAccountHolderUp, invoiceMandateAccountHolderDown)
}

func invoiceMandateAccountHolderUp(ctx context.Context, db *bun.DB) error {
	return db.RunInTx(ctx, &sql.TxOptions{}, func(ctx context.Context, tx bun.Tx) error {
		_, err := tx.ExecContext(ctx, `
ALTER TABLE parent_billing.care_invoices ADD COLUMN account_holder_sealed bytea;
ALTER TABLE parent_billing.documents ADD COLUMN account_holder_sealed bytea;`)
		if err != nil {
			return fmt.Errorf("add the sealed invoice account holder: %w", err)
		}
		return nil
	})
}

func invoiceMandateAccountHolderDown(ctx context.Context, db *bun.DB) error {
	return db.RunInTx(ctx, &sql.TxOptions{}, func(ctx context.Context, tx bun.Tx) error {
		_, err := tx.ExecContext(ctx, `
ALTER TABLE parent_billing.documents DROP COLUMN account_holder_sealed;
ALTER TABLE parent_billing.care_invoices DROP COLUMN account_holder_sealed;`)
		if err != nil {
			return fmt.Errorf("drop the sealed invoice account holder: %w", err)
		}
		return nil
	})
}
