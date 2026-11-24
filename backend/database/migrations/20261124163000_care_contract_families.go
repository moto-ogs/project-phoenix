package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

const careContractFamiliesVersion = "20261124163000"

func init() {
	MigrationRegistry.Register(&Migration{
		Version:     careContractFamiliesVersion,
		Description: "Betreuungsvertrag: Verträge ohne Mail-Adresse von Hand zu einer Familie zusammenführen (#7161)",
		DependsOn: []string{
			careContractApplicationUnbindingVersion, // the newest list of trail actions
		},
	})
	Migrations.MustRegister(careContractFamiliesUp, careContractFamiliesDown)
}

// careContractFamiliesUpSQL lets the Träger-Büro state that contracts whose
// parties have no mail address belong to one family (#7161, ADR 0319):
//
//   - contracts.family_contract_id names the leading contract of the family.
//     The leading contract itself has none, and no contract leads through a
//     chain: the owner command checks both under the lock of the Träger's
//     families, which every change takes. A contract never leads itself.
//   - No foreign key: the leading contract is a contract of the same Träger
//     (the command reads it there), and a deleted one still names one
//     family for the contracts it led.
//   - The trail actions join_family and leave_family record each change
//     with the leading contract before and after it.
//
// Running it again changes nothing.
const careContractFamiliesUpSQL = `
ALTER TABLE care_contract.contracts ADD COLUMN IF NOT EXISTS family_contract_id BIGINT;
ALTER TABLE care_contract.contracts DROP CONSTRAINT IF EXISTS chk_contracts_family_contract;
ALTER TABLE care_contract.contracts ADD CONSTRAINT chk_contracts_family_contract
	CHECK (family_contract_id IS NULL OR family_contract_id <> id);
CREATE INDEX IF NOT EXISTS idx_contracts_family_contract ON care_contract.contracts (organization_id, family_contract_id)
	WHERE family_contract_id IS NOT NULL;
COMMENT ON COLUMN care_contract.contracts.family_contract_id IS
	'Leading contract of the family the Träger-Büro joined this contract to (#7161, ADR 0319); only for contracts whose parties have no mail address.';
GRANT UPDATE (family_contract_id) ON care_contract.contracts TO phoenix_tenant;

ALTER TABLE care_contract.contract_events DROP CONSTRAINT IF EXISTS chk_contract_events_action;
ALTER TABLE care_contract.contract_events ADD CONSTRAINT chk_contract_events_action
	CHECK (action IN ('read', 'create', 'send', 'discard', 'template', 'conclude', 'sign', 'remind', 'terminate', 'withdraw', 'set_end',
		'reject_reason', 'correct', 'link_child', 'unlink_child', 'bind_application', 'unbind', 'join_family', 'leave_family'));
`

// careContractFamiliesDownSQL drops the families and their trail entries
// and restores the list of trail actions of the unbinding.
const careContractFamiliesDownSQL = `
DELETE FROM care_contract.contract_events WHERE action IN ('join_family', 'leave_family');
ALTER TABLE care_contract.contract_events DROP CONSTRAINT chk_contract_events_action;
ALTER TABLE care_contract.contract_events ADD CONSTRAINT chk_contract_events_action
	CHECK (action IN ('read', 'create', 'send', 'discard', 'template', 'conclude', 'sign', 'remind', 'terminate', 'withdraw', 'set_end',
		'reject_reason', 'correct', 'link_child', 'unlink_child', 'bind_application', 'unbind'));
DROP INDEX IF EXISTS care_contract.idx_contracts_family_contract;
ALTER TABLE care_contract.contracts DROP CONSTRAINT IF EXISTS chk_contracts_family_contract;
ALTER TABLE care_contract.contracts DROP COLUMN IF EXISTS family_contract_id;
`

func careContractFamiliesUp(ctx context.Context, db *bun.DB) error {
	if _, err := db.ExecContext(ctx, careContractFamiliesUpSQL); err != nil {
		return fmt.Errorf("add the families of care contracts without a mail address: %w", err)
	}
	return nil
}

func careContractFamiliesDown(ctx context.Context, db *bun.DB) error {
	if _, err := db.ExecContext(ctx, careContractFamiliesDownSQL); err != nil {
		return fmt.Errorf("drop the families of care contracts without a mail address: %w", err)
	}
	return nil
}
