package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

const careContractApplicationBindingVersion = "20261122202100"

func init() {
	MigrationRegistry.Register(&Migration{
		Version:     careContractApplicationBindingVersion,
		Description: "Betreuungsvertrag: importierte Verträge an die Anmeldung des Kindes binden (#7760)",
		DependsOn: []string{
			careContractImportsVersion,    // chk_contracts_origin and import_origin
			careContractChildLinksVersion, // the newest list of trail actions and the link the binding needs
		},
	})
	Migrations.MustRegister(careContractApplicationBindingUp, careContractApplicationBindingDown)
}

// careContractApplicationBindingUpSQL lets an imported contract carry the
// application child of its child as well (#7760, ADR 0308):
//
//   - A contract names its origin by at least one key instead of exactly
//     one. A contract from an application has request_child_id, an imported
//     one import_origin, and an imported contract bound to the enrollment the
//     school made for its child afterwards has both. uq_contracts_application
//     (school_id, request_child_id) stays: one application child has one
//     contract.
//   - The request role may set request_child_id. It could set it only at the
//     insert so far.
//   - The trail action bind_application records the binding.
//
// Running it again changes nothing.
const careContractApplicationBindingUpSQL = `
ALTER TABLE care_contract.contracts DROP CONSTRAINT IF EXISTS chk_contracts_origin;
ALTER TABLE care_contract.contracts ADD CONSTRAINT chk_contracts_origin
	CHECK (request_child_id IS NOT NULL OR import_origin IS NOT NULL);
GRANT UPDATE (request_child_id) ON care_contract.contracts TO phoenix_tenant;
COMMENT ON COLUMN care_contract.contracts.request_child_id IS
	'Application child of the contract (ADR 0153): the origin of a contract from an accepted application, and the enrollment an imported contract was bound to afterwards (#7760); NULL for an imported contract that is not bound.';

ALTER TABLE care_contract.contract_events DROP CONSTRAINT IF EXISTS chk_contract_events_action;
ALTER TABLE care_contract.contract_events ADD CONSTRAINT chk_contract_events_action
	CHECK (action IN ('read', 'create', 'send', 'discard', 'template', 'conclude', 'sign', 'remind', 'terminate', 'withdraw', 'set_end',
		'reject_reason', 'correct', 'link_child', 'unlink_child', 'bind_application'));
`

// careContractApplicationBindingDownSQL restores "exactly one origin". A
// bound imported contract would violate it, so the binding is taken off
// first: the contract stays an imported one linked to its child record, as
// before the binding, and the enrollment of the child stays at the school.
// The entries of bindings go with it, as the entries of links go with
// 20261122150000.
const careContractApplicationBindingDownSQL = `
UPDATE care_contract.contracts SET request_child_id = NULL
	WHERE import_origin IS NOT NULL AND request_child_id IS NOT NULL;
DELETE FROM care_contract.contract_events WHERE action = 'bind_application';
ALTER TABLE care_contract.contract_events DROP CONSTRAINT chk_contract_events_action;
ALTER TABLE care_contract.contract_events ADD CONSTRAINT chk_contract_events_action
	CHECK (action IN ('read', 'create', 'send', 'discard', 'template', 'conclude', 'sign', 'remind', 'terminate', 'withdraw', 'set_end',
		'reject_reason', 'correct', 'link_child', 'unlink_child'));
REVOKE UPDATE (request_child_id) ON care_contract.contracts FROM phoenix_tenant;
ALTER TABLE care_contract.contracts DROP CONSTRAINT chk_contracts_origin;
ALTER TABLE care_contract.contracts ADD CONSTRAINT chk_contracts_origin
	CHECK ((request_child_id IS NULL) <> (import_origin IS NULL));
COMMENT ON COLUMN care_contract.contracts.request_child_id IS
	'Origin of a contract from an accepted application (ADR 0153); NULL for a contract taken over from an import file (#4723).';
`

func careContractApplicationBindingUp(ctx context.Context, db *bun.DB) error {
	if _, err := db.ExecContext(ctx, careContractApplicationBindingUpSQL); err != nil {
		return fmt.Errorf("allow imported care contracts to carry an application child: %w", err)
	}
	return nil
}

func careContractApplicationBindingDown(ctx context.Context, db *bun.DB) error {
	if _, err := db.ExecContext(ctx, careContractApplicationBindingDownSQL); err != nil {
		return fmt.Errorf("restore the single origin of care contracts: %w", err)
	}
	return nil
}
