package migrations

import (
	"context"

	"github.com/uptrace/bun"
)

func init() {
	RegisterRepeatable("care_contract.guard_version_timeline", func(ctx context.Context, tx bun.Tx) error {
		_, err := tx.ExecContext(ctx, repeatableCareContractGuardVersionTimelineSQL)
		return err
	})
}

// repeatableCareContractGuardVersionTimelineSQL is the current definition of
// care_contract.guard_version_timeline() (ADR 0223). It
// keeps the versions in force in order and lets no version take effect in the
// past once the contract had a version in force (#4681, #4816).
// Change the function here; numbered migrations no longer define it.
const repeatableCareContractGuardVersionTimelineSQL = `CREATE OR REPLACE FUNCTION care_contract.guard_version_timeline() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
	IF NEW.status IN ('wirksam', 'abgeloest')
		AND (TG_OP = 'INSERT' OR OLD.status NOT IN ('wirksam', 'abgeloest')) THEN
		IF NEW.status = 'wirksam' AND EXISTS (SELECT 1 FROM care_contract.contract_versions AS v
			WHERE v.organization_id = NEW.organization_id AND v.contract_id = NEW.contract_id AND v.id <> NEW.id
				AND v.status IN ('wirksam', 'abgeloest') AND v.effective_from >= NEW.effective_from) THEN
			RAISE EXCEPTION 'care contract version of contract % must start after every effective version', NEW.contract_id
				USING ERRCODE = 'check_violation';
		END IF;
		IF NEW.status = 'abgeloest' AND NOT EXISTS (SELECT 1 FROM care_contract.contract_versions AS v
			WHERE v.organization_id = NEW.organization_id AND v.contract_id = NEW.contract_id AND v.id <> NEW.id
				AND v.status IN ('wirksam', 'abgeloest') AND v.effective_from > NEW.effective_from) THEN
			RAISE EXCEPTION 'care contract version of contract % inserted as superseded needs a later effective version', NEW.contract_id
				USING ERRCODE = 'check_violation';
		END IF;
		IF EXISTS (SELECT 1 FROM care_contract.contract_versions AS v
			WHERE v.organization_id = NEW.organization_id AND v.contract_id = NEW.contract_id AND v.id <> NEW.id
				AND v.status IN ('wirksam', 'abgeloest', 'ersetzt')) AND NEW.effective_from < (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Berlin')::date THEN
			RAISE EXCEPTION 'care contract version of contract % cannot take effect in the past', NEW.contract_id
				USING ERRCODE = 'check_violation';
		END IF;
	END IF;
	RETURN NEW;
END;
$$;
`
