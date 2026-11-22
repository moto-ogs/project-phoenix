package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

const parentBillingSiblingAllChildrenVersion = "20261122070000"

func init() {
	MigrationRegistry.Register(&Migration{
		Version:     parentBillingSiblingAllChildrenVersion,
		Description: "Elternabrechnung: Geschwisterregel nach Familiengröße für alle Kinder (#7765)",
		DependsOn: []string{
			parentBillingCarePriceFormsVersion, // the newest flags of the care sibling rule and its reductions
			parentBillingFamilyChildrenVersion, // the family's number the rule may count
		},
	})
	Migrations.MustRegister(parentBillingSiblingAllChildrenUp, parentBillingSiblingAllChildrenDown)
}

// parentBillingSiblingAllChildrenUpSQL adds the second way a care sibling
// rule chooses its children (#7765, ADR 0305): by the size of the family
// instead of the child's rank. With sibling_all_children a family of at
// least sibling_from_child counted children gets the reduction for every
// child, the first too. Off by default, so no rule changes by itself. The
// reduction of an invoice keeps a copy of the mode, like the price-list
// mode: its letter then names the family's children, not a rank.
const parentBillingSiblingAllChildrenUpSQL = `
ALTER TABLE parent_billing.contribution_rules
	ADD COLUMN sibling_all_children BOOLEAN NOT NULL DEFAULT FALSE,
	ADD CONSTRAINT chk_contribution_rules_sibling_all_children
		CHECK (NOT sibling_all_children OR (service = 'care' AND kind = 'sibling'));
COMMENT ON COLUMN parent_billing.contribution_rules.sibling_all_children IS
	'A care sibling rule that reduces every child of a family with at least sibling_from_child counted children, instead of the children from that rank on (#7765).';

ALTER TABLE parent_billing.care_invoice_reductions
	ADD COLUMN sibling_all_children BOOLEAN NOT NULL DEFAULT FALSE,
	ADD CONSTRAINT chk_care_invoice_reductions_sibling_all_children
		CHECK (NOT sibling_all_children OR kind = 'sibling');
COMMENT ON COLUMN parent_billing.care_invoice_reductions.sibling_all_children IS
	'Copy of the rule''s mode: the reduction applied because of the size of the family, not the child''s rank (#7765).';
`

const parentBillingSiblingAllChildrenDownSQL = `
ALTER TABLE parent_billing.care_invoice_reductions
	DROP CONSTRAINT chk_care_invoice_reductions_sibling_all_children,
	DROP COLUMN sibling_all_children;
ALTER TABLE parent_billing.contribution_rules
	DROP CONSTRAINT chk_contribution_rules_sibling_all_children,
	DROP COLUMN sibling_all_children;
`

func parentBillingSiblingAllChildrenUp(ctx context.Context, db *bun.DB) error {
	if _, err := db.ExecContext(ctx, parentBillingSiblingAllChildrenUpSQL); err != nil {
		return fmt.Errorf("add the family-size mode of the care sibling rule: %w", err)
	}
	return nil
}

func parentBillingSiblingAllChildrenDown(ctx context.Context, db *bun.DB) error {
	if _, err := db.ExecContext(ctx, parentBillingSiblingAllChildrenDownSQL); err != nil {
		return fmt.Errorf("drop the family-size mode of the care sibling rule: %w", err)
	}
	return nil
}
