package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

const careContractChildLinksVersion = "20261122150000"

func init() {
	MigrationRegistry.Register(&Migration{
		Version:     careContractChildLinksVersion,
		Description: "Betreuungsvertrag: importierte Verträge mit der Kinderakte verknüpfen (#7760)",
		DependsOn: []string{
			careContractImportsVersion,     // the imported contracts this one links
			careContractCorrectionsVersion, // the newest list of trail actions (#7767)
		},
	})
	Migrations.MustRegister(careContractChildLinksUp, careContractChildLinksDown)
}

// careContractChildLinksUpSQL lets the trail of a contract record the link
// of an imported contract to a child record and its removal (#7760, ADR 0307). The link itself is student_id, which the request
// role may update since 1.15.770. Running it again changes nothing.
const careContractChildLinksUpSQL = `
ALTER TABLE care_contract.contract_events DROP CONSTRAINT IF EXISTS chk_contract_events_action;
ALTER TABLE care_contract.contract_events ADD CONSTRAINT chk_contract_events_action
	CHECK (action IN ('read', 'create', 'send', 'discard', 'template', 'conclude', 'sign', 'remind', 'terminate', 'withdraw', 'set_end',
		'reject_reason', 'correct', 'link_child', 'unlink_child'));
`

// careContractChildLinksDownSQL drops the entries of links and restores the
// list of the corrections (#7767). The links themselves stay: student_id is older.
const careContractChildLinksDownSQL = `
DELETE FROM care_contract.contract_events WHERE action IN ('link_child', 'unlink_child');
ALTER TABLE care_contract.contract_events DROP CONSTRAINT chk_contract_events_action;
ALTER TABLE care_contract.contract_events ADD CONSTRAINT chk_contract_events_action
	CHECK (action IN ('read', 'create', 'send', 'discard', 'template', 'conclude', 'sign', 'remind', 'terminate', 'withdraw', 'set_end', 'reject_reason', 'correct'));
`

func careContractChildLinksUp(ctx context.Context, db *bun.DB) error {
	if _, err := db.ExecContext(ctx, careContractChildLinksUpSQL); err != nil {
		return fmt.Errorf("add care contract child link actions: %w", err)
	}
	return nil
}

func careContractChildLinksDown(ctx context.Context, db *bun.DB) error {
	if _, err := db.ExecContext(ctx, careContractChildLinksDownSQL); err != nil {
		return fmt.Errorf("drop care contract child link actions: %w", err)
	}
	return nil
}
