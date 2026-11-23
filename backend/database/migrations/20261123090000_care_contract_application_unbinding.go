package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

const careContractApplicationUnbindingVersion = "20261123090000"

func init() {
	MigrationRegistry.Register(&Migration{
		Version:     careContractApplicationUnbindingVersion,
		Description: "Betreuungsvertrag: Bindung eines importierten Vertrags wieder lösen, Schutz des Anmeldekinds (#7760)",
		DependsOn: []string{
			careContractApplicationBindingVersion, // the binding this one takes off and the newest list of trail actions
		},
	})
	Migrations.MustRegister(careContractApplicationUnbindingUp, careContractApplicationUnbindingDown)
}

// careContractApplicationUnbindingUpSQL lets the Träger-Büro take the
// application child off a bound imported contract again (#7760, ADR 0309)
// and narrows what the request role may do with request_child_id:
//
//   - The trail action unbind records the way back.
//   - The request role may update request_child_id since 20261122202100,
//     without a condition. A trigger keeps the column to the two changes the
//     application makes: an imported contract is bound (NULL to a value) or
//     unbound (a value to NULL). The application child of a contract from an
//     application never changes, and a bound contract is not moved to
//     another application child in one step.
//   - An insert is not guarded: a bound imported contract carries both
//     origins by right, and a restore of the Träger's data inserts it as it
//     is. The application inserts a contract with one origin only.
//
// The trigger guards the shape of the transition, not which application
// child is named: whether the child is the one the school's enrollment
// confirmed for the contract is checked by the owner command
// (BindApplications, ADR 0309) under its locks. On purpose there is no check
// against the enrollment schema here: the application child lives in the
// school's tenant, the contract at the Träger, and no constraint joins the
// two (ADR 0105).
//
// Running it again changes nothing.
const careContractApplicationUnbindingUpSQL = `
ALTER TABLE care_contract.contract_events DROP CONSTRAINT IF EXISTS chk_contract_events_action;
ALTER TABLE care_contract.contract_events ADD CONSTRAINT chk_contract_events_action
	CHECK (action IN ('read', 'create', 'send', 'discard', 'template', 'conclude', 'sign', 'remind', 'terminate', 'withdraw', 'set_end',
		'reject_reason', 'correct', 'link_child', 'unlink_child', 'bind_application', 'unbind'));

CREATE OR REPLACE FUNCTION care_contract.guard_contract_application_child() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
	IF NEW.request_child_id IS NOT DISTINCT FROM OLD.request_child_id THEN
		RETURN NEW;
	END IF;
	IF OLD.import_origin IS NULL THEN
		RAISE EXCEPTION 'the application child of a contract from an application does not change'
			USING ERRCODE = 'check_violation', CONSTRAINT = 'guard_contract_application_child';
	END IF;
	IF OLD.request_child_id IS NOT NULL AND NEW.request_child_id IS NOT NULL THEN
		RAISE EXCEPTION 'a bound imported contract is unbound before it is bound to another application child'
			USING ERRCODE = 'check_violation', CONSTRAINT = 'guard_contract_application_child';
	END IF;
	RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS guard_contract_application_child ON care_contract.contracts;
CREATE TRIGGER guard_contract_application_child
	BEFORE UPDATE OF request_child_id ON care_contract.contracts
	FOR EACH ROW EXECUTE FUNCTION care_contract.guard_contract_application_child();
`

// careContractApplicationUnbindingDownSQL drops the guard and the entries
// of the way back and restores the list of the binding.
const careContractApplicationUnbindingDownSQL = `
DROP TRIGGER IF EXISTS guard_contract_application_child ON care_contract.contracts;
DROP FUNCTION IF EXISTS care_contract.guard_contract_application_child();
DELETE FROM care_contract.contract_events WHERE action = 'unbind';
ALTER TABLE care_contract.contract_events DROP CONSTRAINT chk_contract_events_action;
ALTER TABLE care_contract.contract_events ADD CONSTRAINT chk_contract_events_action
	CHECK (action IN ('read', 'create', 'send', 'discard', 'template', 'conclude', 'sign', 'remind', 'terminate', 'withdraw', 'set_end',
		'reject_reason', 'correct', 'link_child', 'unlink_child', 'bind_application'));
`

func careContractApplicationUnbindingUp(ctx context.Context, db *bun.DB) error {
	if _, err := db.ExecContext(ctx, careContractApplicationUnbindingUpSQL); err != nil {
		return fmt.Errorf("allow taking the application child off an imported care contract: %w", err)
	}
	return nil
}

func careContractApplicationUnbindingDown(ctx context.Context, db *bun.DB) error {
	if _, err := db.ExecContext(ctx, careContractApplicationUnbindingDownSQL); err != nil {
		return fmt.Errorf("drop the unbinding of imported care contracts: %w", err)
	}
	return nil
}
