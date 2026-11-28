package migrations

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/uptrace/bun"
)

const careInvoiceRecipientContractEmailVersion = "20261128113000"

func init() {
	MigrationRegistry.Register(&Migration{
		Version:     careInvoiceRecipientContractEmailVersion,
		Description: "Monatsrechnungen halten die Vertragsadresse fest, wenn sie an die Adresse des Elternkontos gehen (#8215)",
		DependsOn:   []string{parentBillingIssuersVersion},
	})
	Migrations.MustRegister(careInvoiceRecipientContractEmailUp, careInvoiceRecipientContractEmailDown)
}

func careInvoiceRecipientContractEmailUp(ctx context.Context, db *bun.DB) error {
	return db.RunInTx(ctx, &sql.TxOptions{}, func(ctx context.Context, tx bun.Tx) error {
		_, err := tx.ExecContext(ctx, `
ALTER TABLE parent_billing.care_invoices ADD COLUMN recipient_contract_email TEXT
	CONSTRAINT chk_care_invoices_recipient_contract_email CHECK (char_length(recipient_contract_email) <= 320);
COMMENT ON COLUMN parent_billing.care_invoices.recipient_contract_email IS
	'The contract''s address when the invoice went to the differing address of the parents account (#8215); NULL otherwise.';`)
		if err != nil {
			return fmt.Errorf("add the contract address of the care invoice recipient: %w", err)
		}
		return nil
	})
}

func careInvoiceRecipientContractEmailDown(ctx context.Context, db *bun.DB) error {
	return db.RunInTx(ctx, &sql.TxOptions{}, func(ctx context.Context, tx bun.Tx) error {
		_, err := tx.ExecContext(ctx, `ALTER TABLE parent_billing.care_invoices DROP COLUMN recipient_contract_email;`)
		if err != nil {
			return fmt.Errorf("drop the contract address of the care invoice recipient: %w", err)
		}
		return nil
	})
}
