package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

// 20261117231923_care_evidence_rule_key_checked_at_statement_end.go
const careEvidenceRuleKeyNoActionVersion = "20261117231923"

func init() {
	MigrationRegistry.Register(&Migration{
		Version:     careEvidenceRuleKeyNoActionVersion,
		Description: "Nachweise zum Monatsbeitrag halten die Träger-Löschung nicht mehr auf (#7248)",
		DependsOn: []string{
			parentBillingCareReductionsVersion, // created parent_billing.care_evidences with the key
		},
	})
	Migrations.MustRegister(careEvidenceRuleKeyNoActionUp, careEvidenceRuleKeyNoActionDown)
}

// careEvidenceRuleKeyNoActionUpSQL turns the evidence's reference to its
// income level from RESTRICT into NO ACTION (#7248). RESTRICT is checked
// at once: when the cascade of a Träger root reached the rules before the
// contracts, the evidence still existed and stopped the erasure of the
// whole Träger. NO ACTION is checked after the statement, and its key is
// DEFERRABLE INITIALLY IMMEDIATE: deleting one income level an evidence
// names still fails at once (ErrCareRuleInUse), while the erasure of the
// Träger defers this key to after the root's cascade, when the evidence
// went with its contract.
const careEvidenceRuleKeyNoActionUpSQL = `
ALTER TABLE parent_billing.care_evidences DROP CONSTRAINT IF EXISTS fk_care_evidences_rule;
ALTER TABLE parent_billing.care_evidences ADD CONSTRAINT fk_care_evidences_rule FOREIGN KEY (organization_id, rule_id)
	REFERENCES parent_billing.contribution_rules (organization_id, id) ON DELETE NO ACTION
	DEFERRABLE INITIALLY IMMEDIATE;
`

const careEvidenceRuleKeyNoActionDownSQL = `
ALTER TABLE parent_billing.care_evidences DROP CONSTRAINT IF EXISTS fk_care_evidences_rule;
ALTER TABLE parent_billing.care_evidences ADD CONSTRAINT fk_care_evidences_rule FOREIGN KEY (organization_id, rule_id)
	REFERENCES parent_billing.contribution_rules (organization_id, id) ON DELETE RESTRICT;
`

func careEvidenceRuleKeyNoActionUp(ctx context.Context, db *bun.DB) error {
	return db.RunInTx(ctx, nil, func(ctx context.Context, tx bun.Tx) error {
		if _, err := tx.ExecContext(ctx, careEvidenceRuleKeyNoActionUpSQL); err != nil {
			return fmt.Errorf("check the evidence's income level after the statement: %w", err)
		}
		return nil
	})
}

func careEvidenceRuleKeyNoActionDown(ctx context.Context, db *bun.DB) error {
	return db.RunInTx(ctx, nil, func(ctx context.Context, tx bun.Tx) error {
		if _, err := tx.ExecContext(ctx, careEvidenceRuleKeyNoActionDownSQL); err != nil {
			return fmt.Errorf("restrict the evidence's income level again: %w", err)
		}
		return nil
	})
}
