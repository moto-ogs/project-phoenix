package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

const careContractDocumentIssuerVersion = "20261124150100"

func init() {
	MigrationRegistry.Register(&Migration{
		Version:     careContractDocumentIssuerVersion,
		Description: "Betreuungsvertrag: Das eingefrorene PDF hält die Stelle fest, die es ausgestellt hat (#4811)",
		DependsOn: []string{
			schoolResponsiblePartiesVersion, // the bodies a contract may name instead of the Träger
		},
	})
	Migrations.MustRegister(careContractDocumentIssuerUp, careContractDocumentIssuerDown)
}

// careContractDocumentIssuerUpSQL lets a frozen contract PDF keep the body
// that issued it (#4811): sender text and contact of the Schulträger or the
// Gemeinde that concluded the contracts of the school when the PDF froze.
// NULL is the Träger, which issued every PDF before; its letterhead is read
// when needed, as before. Mails, the signing page and reminders of a sent
// contract name this body, so a later change of the responsibility leaves
// issued contracts as they are.
const careContractDocumentIssuerUpSQL = `
ALTER TABLE care_contract.contract_documents ADD COLUMN issuer JSONB;
ALTER TABLE care_contract.contract_documents ADD CONSTRAINT chk_contract_documents_issuer
	CHECK (issuer IS NULL OR (jsonb_typeof(issuer) = 'object' AND BTRIM(COALESCE(issuer->>'sender_text', '')) <> ''));
COMMENT ON COLUMN care_contract.contract_documents.issuer IS
	'Body that issued the PDF in place of the Träger (#4811): sender text and contact of the Schulträger or Gemeinde at the time; NULL for the Träger.';
`

const careContractDocumentIssuerDownSQL = `
ALTER TABLE care_contract.contract_documents DROP CONSTRAINT IF EXISTS chk_contract_documents_issuer;
ALTER TABLE care_contract.contract_documents DROP COLUMN IF EXISTS issuer;
`

func careContractDocumentIssuerUp(ctx context.Context, db *bun.DB) error {
	if _, err := db.ExecContext(ctx, careContractDocumentIssuerUpSQL); err != nil {
		return fmt.Errorf("add the issuer of a care contract document: %w", err)
	}
	return nil
}

func careContractDocumentIssuerDown(ctx context.Context, db *bun.DB) error {
	if _, err := db.ExecContext(ctx, careContractDocumentIssuerDownSQL); err != nil {
		return fmt.Errorf("drop the issuer of a care contract document: %w", err)
	}
	return nil
}
