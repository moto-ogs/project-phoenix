package migrations

import (
	"context"

	"github.com/uptrace/bun"
)

func init() {
	RegisterRepeatable("platform.erase_retired_demo_traeger", func(ctx context.Context, tx bun.Tx) error {
		_, err := tx.ExecContext(ctx, repeatablePlatformEraseRetiredDemoTraegerSQL)
		return err
	})
}

// repeatablePlatformEraseRetiredDemoTraegerSQL lets the demo process erase
// the Träger of a demo order once its last school is erased from the
// database (#6193, ADR 0271). It is the demo's counterpart of
// platform.erase_organization, as platform.erase_retired_demo_school is of the
// operator's school erasure (ADR 0189): no operator order, no grace period,
// because the demo has no customer.
//
// Due-ness and the list of due Träger are platform.retired_demo_traeger_due
// and platform.retired_demo_traegers_due_for_erasure (migration
// 20261116170000). A Träger is due when all of these hold:
//   - it has a demo origin (platform.demo_traeger_origins): only a Träger a
//     demo order created for itself is ever selected, never the shared
//     Demo-Träger or a Träger restored into the demo database;
//   - none of its schools is left: each went through the 90-day database
//     erasure of retired demo schools;
//   - no demo order names it any more.
//
// The deletion is the one of platform.erase_organization: the foreign keys of
// every Träger table cascade from platform.organizations. The evidence is the
// time and the counts on the origin row, no names. Each call erases one
// Träger in its own transaction; a failure rolls it back and returns only the
// SQLSTATE, never a message that could carry a personal value.
const repeatablePlatformEraseRetiredDemoTraegerSQL = `
	CREATE OR REPLACE FUNCTION platform.erase_retired_demo_traeger(p_organization_id BIGINT)
	RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
	SET search_path = pg_catalog SET lock_timeout = '100ms'
	AS $body$
	DECLARE
		v_counts JSONB;
		v_error TEXT;
	BEGIN
		IF p_organization_id IS NULL OR p_organization_id <= 0 THEN
			RAISE EXCEPTION 'demo Träger erasure requires a Träger' USING ERRCODE = '22023';
		END IF;
		-- The same key as the operator's Träger erasure: never both at once.
		IF NOT pg_try_advisory_xact_lock(hashtextextended('organization-erasure:' || p_organization_id::text, 0)) THEN
			RETURN jsonb_build_object('status', 'busy');
		END IF;
		BEGIN
			-- The row lock keeps any school from joining until the deletion ends.
			PERFORM 1 FROM platform.organizations AS organization
			WHERE organization.id = p_organization_id AND platform.retired_demo_traeger_due(p_organization_id)
			FOR UPDATE;
			IF NOT FOUND THEN
				RETURN jsonb_build_object('status', 'not_due');
			END IF;
			v_counts := jsonb_build_object(
				'platform.organizations', 1,
				'platform.organization_accounts', (SELECT count(*) FROM platform.organization_accounts WHERE organization_id = p_organization_id),
				'auth.organization_account_roles', (SELECT count(*) FROM auth.organization_account_roles WHERE organization_id = p_organization_id),
				'auth.tokens', (SELECT count(*) FROM auth.tokens WHERE organization_id = p_organization_id),
				'auth.mfa_trusted_devices', (SELECT count(*) FROM auth.mfa_trusted_devices WHERE organization_id = p_organization_id),
				'workforce.staff_records', (SELECT count(*) FROM workforce.staff_records WHERE organization_id = p_organization_id),
				'care_contract.contracts', (SELECT count(*) FROM care_contract.contracts WHERE organization_id = p_organization_id),
				'parent_billing.runs', (SELECT count(*) FROM parent_billing.runs WHERE organization_id = p_organization_id),
				'enrollment.holiday_registrations', (SELECT count(*) FROM enrollment.holiday_registrations WHERE organization_id = p_organization_id));
			-- Every Träger table cascades from its root. An evidence names its
			-- income level and goes with its contract: as in
			-- platform.erase_organization its rule key is checked after the
			-- whole cascade, not when the rules go first (#7248).
			SET CONSTRAINTS parent_billing.fk_care_evidences_rule DEFERRED;
			DELETE FROM platform.organizations WHERE id = p_organization_id;
			SET CONSTRAINTS parent_billing.fk_care_evidences_rule IMMEDIATE;
			UPDATE platform.demo_traeger_origins
			SET erased_at = clock_timestamp(), row_counts = v_counts
			WHERE organization_id = p_organization_id;
		EXCEPTION
			WHEN lock_not_available THEN
				-- Another transaction holds a Träger table: try again next run.
				RETURN jsonb_build_object('status', 'busy');
			WHEN OTHERS OR query_canceled THEN
				GET STACKED DIAGNOSTICS v_error = RETURNED_SQLSTATE;
				RETURN jsonb_build_object('status', 'failed', 'error_code', v_error);
		END;
		RETURN jsonb_build_object('status', 'erased', 'row_counts', v_counts);
	END $body$;

	REVOKE ALL ON FUNCTION platform.erase_retired_demo_traeger(BIGINT)
		FROM PUBLIC, phoenix_auth, phoenix_tenant, phoenix_admin, phoenix_school_erasure;
	GRANT EXECUTE ON FUNCTION platform.erase_retired_demo_traeger(BIGINT) TO phoenix_demo;
`
