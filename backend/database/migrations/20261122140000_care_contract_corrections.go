package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

const careContractCorrectionsVersion = "20261122140000"

func init() {
	MigrationRegistry.Register(&Migration{
		Version:     careContractCorrectionsVersion,
		Description: "Betreuungsvertrag: Angaben übernommener Verträge nachpflegen (#7767)",
		DependsOn: []string{
			careContractImportsVersion,           // import_origin names the contracts a correction may touch
			careContractConclusionVersion,        // concluded_at and conclusion_method
			careContractNoticeEndDecisionVersion, // the newest list of trail actions
		},
	})
	Migrations.MustRegister(careContractCorrectionsUp, careContractCorrectionsDown)
}

// careContractCorrectionsUpSQL lets the Träger-Büro complete what an import
// could only assume about a contract it took over (#7767):
//
//   - conclusion_date_unknown tells that no proof names the day the contract
//     was concluded. concluded_at then keeps the instant the takeover
//     recorded, because an active contract must carry one
//     (chk_contracts_active_concluded); it is no date of the conclusion and
//     nothing shows or counts from it. Only a contract from an import can
//     carry the mark: moto records the conclusion of its own contracts.
//   - The request role may set the mark and correct the name of a party. It
//     adds further parties with the INSERT it already has and never removes
//     one: the e-mail address and the account of a party are what the
//     Elternabrechnung finds the family by.
//   - The trail action correct records each correction with the values
//     before and after and the proof the office named.
const careContractCorrectionsUpSQL = `
ALTER TABLE care_contract.contracts ADD COLUMN conclusion_date_unknown BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE care_contract.contracts ADD CONSTRAINT chk_contracts_conclusion_date_unknown
	CHECK (NOT conclusion_date_unknown OR (import_origin IS NOT NULL AND concluded_at IS NOT NULL));
COMMENT ON COLUMN care_contract.contracts.conclusion_date_unknown IS
	'No proof names the day a contract from an import was concluded (#7767): concluded_at then holds the instant the takeover recorded and is no date of the conclusion.';
GRANT UPDATE (conclusion_date_unknown) ON care_contract.contracts TO phoenix_tenant;
GRANT UPDATE (first_name, last_name) ON care_contract.contract_parties TO phoenix_tenant;

ALTER TABLE care_contract.contract_events DROP CONSTRAINT IF EXISTS chk_contract_events_action;
ALTER TABLE care_contract.contract_events ADD CONSTRAINT chk_contract_events_action
	CHECK (action IN ('read', 'create', 'send', 'discard', 'template', 'conclude', 'sign', 'remind', 'terminate', 'withdraw', 'set_end', 'reject_reason', 'correct'));
`

// careContractCorrectionsDownSQL drops the mark and the trail action while
// nothing carries them. Once a contract is corrected or its day of the
// conclusion is unknown it refuses: without the trail the corrected values
// would stand without their proof, and without the mark the instant of the
// takeover would read as the day of the conclusion.
const careContractCorrectionsDownSQL = `
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM care_contract.contract_events WHERE action = 'correct')
		OR EXISTS (SELECT 1 FROM care_contract.contracts WHERE conclusion_date_unknown) THEN
		RAISE EXCEPTION 'care contract corrections are stored: this migration cannot be rolled back';
	END IF;
END $$;
ALTER TABLE care_contract.contract_events DROP CONSTRAINT chk_contract_events_action;
ALTER TABLE care_contract.contract_events ADD CONSTRAINT chk_contract_events_action
	CHECK (action IN ('read', 'create', 'send', 'discard', 'template', 'conclude', 'sign', 'remind', 'terminate', 'withdraw', 'set_end', 'reject_reason'));
REVOKE UPDATE (first_name, last_name) ON care_contract.contract_parties FROM phoenix_tenant;
REVOKE UPDATE (conclusion_date_unknown) ON care_contract.contracts FROM phoenix_tenant;
ALTER TABLE care_contract.contracts
	DROP CONSTRAINT IF EXISTS chk_contracts_conclusion_date_unknown,
	DROP COLUMN IF EXISTS conclusion_date_unknown;
`

func careContractCorrectionsUp(ctx context.Context, db *bun.DB) error {
	if _, err := db.ExecContext(ctx, careContractCorrectionsUpSQL); err != nil {
		return fmt.Errorf("allow corrections of imported care contracts: %w", err)
	}
	return nil
}

func careContractCorrectionsDown(ctx context.Context, db *bun.DB) error {
	if _, err := db.ExecContext(ctx, careContractCorrectionsDownSQL); err != nil {
		return fmt.Errorf("remove corrections of imported care contracts: %w", err)
	}
	return nil
}
