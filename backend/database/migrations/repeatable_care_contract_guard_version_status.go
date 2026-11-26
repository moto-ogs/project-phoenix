package migrations

import (
	"context"

	"github.com/uptrace/bun"
)

func init() {
	RegisterRepeatable("care_contract.guard_version_status", func(ctx context.Context, tx bun.Tx) error {
		_, err := tx.ExecContext(ctx, repeatableCareContractGuardVersionStatusSQL)
		return err
	})
}

// repeatableCareContractGuardVersionStatusSQL is the current definition of
// care_contract.guard_version_status() (ADR 0223). It
// allows a waiting version to take effect, to take effect already superseded,
// to be rejected or to be overtaken by a newer waiting version (#4816).
// Change the function here; numbered migrations no longer define it.
const repeatableCareContractGuardVersionStatusSQL = `CREATE OR REPLACE FUNCTION care_contract.guard_version_status() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
	IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
		(OLD.status = 'beantragt' AND NEW.status IN ('wirksam', 'abgeloest', 'abgelehnt', 'ueberholt'))
		OR (OLD.status = 'wirksam' AND NEW.status IN ('abgeloest', 'ersetzt'))
		OR (OLD.status = 'abgeloest' AND NEW.status = 'ersetzt')) THEN
		RAISE EXCEPTION 'care contract version % cannot move from % to %', OLD.id, OLD.status, NEW.status
			USING ERRCODE = 'check_violation';
	END IF;
	RETURN NEW;
END;
$$;
`
