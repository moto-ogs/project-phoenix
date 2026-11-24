package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

const parentBillingIssuersVersion = "20261124190000"

func init() {
	MigrationRegistry.Register(&Migration{
		Version:     parentBillingIssuersVersion,
		Description: "Elternabrechnung: Rechnungssteller je Schule mit eigener Gläubiger-ID, eigenem Nummernkreis und eigenen Mandaten (#8040)",
		DependsOn: []string{
			traegerPayrollEmployersVersion,  // the newest migration on development
			schoolResponsiblePartiesVersion, // the bodies that may issue a document
		},
	})
	Migrations.MustRegister(parentBillingIssuersUp, parentBillingIssuersDown)
}

// parentBillingIssuersUpSQL lets a Schulträger or a Gemeinde bill the
// parents of a school itself (#8040, ADR 0322). An issuer is named by its
// key: empty for the Träger, else the SEPA creditor identifier of the body.
//
//   - The issued documents keep their issuer: issuer_key, and in issuer the
//     sender, contact, bank account and creditor identifier of the body at
//     the release (NULL for the Träger). A cancellation of a monthly invoice
//     keeps the key of its invoice. The numbers are unique per Träger and
//     issuer.
//   - Number range, counter, start values and kind of document are kept per
//     issuer and service.
//   - A mandate in force is unique per family and creditor identifier: a
//     mandate holds only for the creditor it was given to.
//
// Every existing row is the Träger's and keeps the empty key.
const parentBillingIssuersUpSQL = `
ALTER TABLE parent_billing.number_ranges
	ADD COLUMN issuer_key VARCHAR(35) NOT NULL DEFAULT '',
	ADD CONSTRAINT chk_number_ranges_issuer CHECK (issuer_key = '' OR issuer_key ~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{3}[A-Z0-9]{1,28}$'),
	DROP CONSTRAINT uq_number_ranges_service,
	ADD CONSTRAINT uq_number_ranges_service UNIQUE (organization_id, issuer_key, service);
COMMENT ON COLUMN parent_billing.number_ranges.issuer_key IS
	'Issuer the pattern numbers for (#8040, ADR 0322): empty for the Träger, else the creditor identifier of the body.';

ALTER TABLE parent_billing.number_range_counters
	ADD COLUMN issuer_key VARCHAR(35) NOT NULL DEFAULT '',
	ADD CONSTRAINT chk_number_range_counters_issuer CHECK (issuer_key = '' OR issuer_key ~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{3}[A-Z0-9]{1,28}$'),
	DROP CONSTRAINT number_range_counters_pkey,
	ADD CONSTRAINT number_range_counters_pkey PRIMARY KEY (organization_id, issuer_key, service, year);
COMMENT ON COLUMN parent_billing.number_range_counters.issuer_key IS
	'Issuer the counter numbers for (#8040, ADR 0322): empty for the Träger, else the creditor identifier of the body.';

ALTER TABLE parent_billing.number_range_starts
	ADD COLUMN issuer_key VARCHAR(35) NOT NULL DEFAULT '',
	ADD CONSTRAINT chk_number_range_starts_issuer CHECK (issuer_key = '' OR issuer_key ~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{3}[A-Z0-9]{1,28}$');
DROP INDEX parent_billing.idx_number_range_starts_counter;
CREATE INDEX idx_number_range_starts_counter
	ON parent_billing.number_range_starts (organization_id, issuer_key, service, year, id DESC);

ALTER TABLE parent_billing.document_kinds
	ADD COLUMN issuer_key VARCHAR(35) NOT NULL DEFAULT '',
	ADD CONSTRAINT chk_document_kinds_issuer CHECK (issuer_key = '' OR issuer_key ~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{3}[A-Z0-9]{1,28}$'),
	DROP CONSTRAINT document_kinds_pkey,
	ADD CONSTRAINT document_kinds_pkey PRIMARY KEY (organization_id, issuer_key, service);
COMMENT ON COLUMN parent_billing.document_kinds.issuer_key IS
	'Issuer that issues this kind (#8040, ADR 0322): empty for the Träger, else the creditor identifier of the body.';

ALTER TABLE parent_billing.documents
	ADD COLUMN issuer_key VARCHAR(35) NOT NULL DEFAULT '',
	ADD COLUMN issuer JSONB,
	ADD CONSTRAINT chk_documents_issuer CHECK ((issuer_key = '') = (issuer IS NULL)
		AND (issuer IS NULL OR (jsonb_typeof(issuer) = 'object' AND issuer->>'creditor_id' = issuer_key
			AND BTRIM(COALESCE(issuer->>'sender_text', '')) <> ''))),
	DROP CONSTRAINT uq_documents_number,
	ADD CONSTRAINT uq_documents_number UNIQUE (organization_id, issuer_key, number),
	DROP CONSTRAINT uq_documents_sequence,
	ADD CONSTRAINT uq_documents_sequence UNIQUE (organization_id, issuer_key, service, number_year, number_sequence);
COMMENT ON COLUMN parent_billing.documents.issuer IS
	'Body that issued the document in place of the Träger (#8040, ADR 0322): sender, contact, bank account and creditor identifier at the release; NULL for the Träger.';

ALTER TABLE parent_billing.care_invoices
	ADD COLUMN issuer_key VARCHAR(35) NOT NULL DEFAULT '',
	ADD COLUMN issuer JSONB,
	ADD CONSTRAINT chk_care_invoices_issuer CHECK ((issuer_key = '') = (issuer IS NULL)
		AND (issuer IS NULL OR (jsonb_typeof(issuer) = 'object' AND issuer->>'creditor_id' = issuer_key
			AND BTRIM(COALESCE(issuer->>'sender_text', '')) <> ''))),
	DROP CONSTRAINT uq_care_invoices_number,
	ADD CONSTRAINT uq_care_invoices_number UNIQUE (organization_id, issuer_key, number),
	DROP CONSTRAINT uq_care_invoices_sequence,
	ADD CONSTRAINT uq_care_invoices_sequence UNIQUE (organization_id, issuer_key, number_year, number_sequence);
COMMENT ON COLUMN parent_billing.care_invoices.issuer IS
	'Body that issued the invoice in place of the Träger (#8040, ADR 0322): sender, contact, bank account and creditor identifier at the release; NULL for the Träger.';

ALTER TABLE parent_billing.care_invoice_cancellations
	ADD COLUMN issuer_key VARCHAR(35) NOT NULL DEFAULT '',
	ADD CONSTRAINT chk_care_invoice_cancellations_issuer CHECK (issuer_key = '' OR issuer_key ~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{3}[A-Z0-9]{1,28}$'),
	DROP CONSTRAINT uq_care_invoice_cancellations_number,
	ADD CONSTRAINT uq_care_invoice_cancellations_number UNIQUE (organization_id, issuer_key, number),
	DROP CONSTRAINT uq_care_invoice_cancellations_sequence,
	ADD CONSTRAINT uq_care_invoice_cancellations_sequence UNIQUE (organization_id, issuer_key, number_year, number_sequence);
COMMENT ON COLUMN parent_billing.care_invoice_cancellations.issuer_key IS
	'Issuer of the cancelled invoice, whose number range numbers the Storno (#8040, ADR 0322).';

ALTER TABLE parent_billing.care_notices
	ADD COLUMN issuer_key VARCHAR(35) NOT NULL DEFAULT '',
	ADD COLUMN issuer JSONB,
	ADD CONSTRAINT chk_care_notices_issuer CHECK ((issuer_key = '') = (issuer IS NULL)
		AND (issuer IS NULL OR (jsonb_typeof(issuer) = 'object' AND issuer->>'creditor_id' = issuer_key
			AND BTRIM(COALESCE(issuer->>'sender_text', '')) <> ''))),
	DROP CONSTRAINT uq_care_notices_number,
	ADD CONSTRAINT uq_care_notices_number UNIQUE (organization_id, issuer_key, number),
	DROP CONSTRAINT uq_care_notices_sequence,
	ADD CONSTRAINT uq_care_notices_sequence UNIQUE (organization_id, issuer_key, number_year, number_sequence);
COMMENT ON COLUMN parent_billing.care_notices.issuer IS
	'Body that issued the Jahresbescheid in place of the Träger (#8040, ADR 0322): sender, contact, bank account and creditor identifier at the release; NULL for the Träger.';

DROP INDEX parent_billing.uq_sepa_mandates_in_force;
CREATE UNIQUE INDEX uq_sepa_mandates_in_force ON parent_billing.sepa_mandates (organization_id, family_email, creditor_id)
	WHERE revoked_on IS NULL;
`

// parentBillingIssuersDownSQL restores one issuer per Träger. It refuses
// while a body issued a document or keeps a number range, a counter, a
// start or a kind of its own, and fails while a family holds two mandates
// in force: those rows have no place in the older schema, and dropping the
// key would hand a body's documents to the Träger.
const parentBillingIssuersDownSQL = `
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM parent_billing.documents WHERE issuer_key <> '')
		OR EXISTS (SELECT 1 FROM parent_billing.care_invoices WHERE issuer_key <> '')
		OR EXISTS (SELECT 1 FROM parent_billing.care_invoice_cancellations WHERE issuer_key <> '')
		OR EXISTS (SELECT 1 FROM parent_billing.care_notices WHERE issuer_key <> '')
		OR EXISTS (SELECT 1 FROM parent_billing.number_ranges WHERE issuer_key <> '')
		OR EXISTS (SELECT 1 FROM parent_billing.number_range_counters WHERE issuer_key <> '')
		OR EXISTS (SELECT 1 FROM parent_billing.number_range_starts WHERE issuer_key <> '')
		OR EXISTS (SELECT 1 FROM parent_billing.document_kinds WHERE issuer_key <> '') THEN
		RAISE EXCEPTION 'a Schulträger or a Gemeinde issued documents or keeps a number range or a kind of its own; the older schema has no place for them';
	END IF;
END $$;

DROP INDEX parent_billing.uq_sepa_mandates_in_force;
CREATE UNIQUE INDEX uq_sepa_mandates_in_force ON parent_billing.sepa_mandates (organization_id, family_email)
	WHERE revoked_on IS NULL;

ALTER TABLE parent_billing.care_notices
	DROP CONSTRAINT uq_care_notices_sequence,
	ADD CONSTRAINT uq_care_notices_sequence UNIQUE (organization_id, number_year, number_sequence),
	DROP CONSTRAINT uq_care_notices_number,
	ADD CONSTRAINT uq_care_notices_number UNIQUE (organization_id, number),
	DROP CONSTRAINT chk_care_notices_issuer,
	DROP COLUMN issuer,
	DROP COLUMN issuer_key;

ALTER TABLE parent_billing.care_invoice_cancellations
	DROP CONSTRAINT uq_care_invoice_cancellations_sequence,
	ADD CONSTRAINT uq_care_invoice_cancellations_sequence UNIQUE (organization_id, number_year, number_sequence),
	DROP CONSTRAINT uq_care_invoice_cancellations_number,
	ADD CONSTRAINT uq_care_invoice_cancellations_number UNIQUE (organization_id, number),
	DROP CONSTRAINT chk_care_invoice_cancellations_issuer,
	DROP COLUMN issuer_key;

ALTER TABLE parent_billing.care_invoices
	DROP CONSTRAINT uq_care_invoices_sequence,
	ADD CONSTRAINT uq_care_invoices_sequence UNIQUE (organization_id, number_year, number_sequence),
	DROP CONSTRAINT uq_care_invoices_number,
	ADD CONSTRAINT uq_care_invoices_number UNIQUE (organization_id, number),
	DROP CONSTRAINT chk_care_invoices_issuer,
	DROP COLUMN issuer,
	DROP COLUMN issuer_key;

ALTER TABLE parent_billing.documents
	DROP CONSTRAINT uq_documents_sequence,
	ADD CONSTRAINT uq_documents_sequence UNIQUE (organization_id, service, number_year, number_sequence),
	DROP CONSTRAINT uq_documents_number,
	ADD CONSTRAINT uq_documents_number UNIQUE (organization_id, number),
	DROP CONSTRAINT chk_documents_issuer,
	DROP COLUMN issuer,
	DROP COLUMN issuer_key;

ALTER TABLE parent_billing.document_kinds
	DROP CONSTRAINT document_kinds_pkey,
	ADD CONSTRAINT document_kinds_pkey PRIMARY KEY (organization_id, service),
	DROP CONSTRAINT chk_document_kinds_issuer,
	DROP COLUMN issuer_key;

DROP INDEX parent_billing.idx_number_range_starts_counter;
ALTER TABLE parent_billing.number_range_starts
	DROP CONSTRAINT chk_number_range_starts_issuer,
	DROP COLUMN issuer_key;
CREATE INDEX idx_number_range_starts_counter
	ON parent_billing.number_range_starts (organization_id, service, year, id DESC);

ALTER TABLE parent_billing.number_range_counters
	DROP CONSTRAINT number_range_counters_pkey,
	ADD CONSTRAINT number_range_counters_pkey PRIMARY KEY (organization_id, service, year),
	DROP CONSTRAINT chk_number_range_counters_issuer,
	DROP COLUMN issuer_key;

ALTER TABLE parent_billing.number_ranges
	DROP CONSTRAINT uq_number_ranges_service,
	ADD CONSTRAINT uq_number_ranges_service UNIQUE (organization_id, service),
	DROP CONSTRAINT chk_number_ranges_issuer,
	DROP COLUMN issuer_key;
`

func parentBillingIssuersUp(ctx context.Context, db *bun.DB) error {
	if _, err := db.ExecContext(ctx, parentBillingIssuersUpSQL); err != nil {
		return fmt.Errorf("add the issuers of the parent billing: %w", err)
	}
	return nil
}

func parentBillingIssuersDown(ctx context.Context, db *bun.DB) error {
	if _, err := db.ExecContext(ctx, parentBillingIssuersDownSQL); err != nil {
		return fmt.Errorf("drop the issuers of the parent billing: %w", err)
	}
	return nil
}
