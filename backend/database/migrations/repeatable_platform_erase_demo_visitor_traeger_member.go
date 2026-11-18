package migrations

import (
	"context"

	"github.com/uptrace/bun"
)

func init() {
	RegisterRepeatable("platform.erase_demo_visitor_traeger_member", func(ctx context.Context, tx bun.Tx) error {
		_, err := tx.ExecContext(ctx, repeatablePlatformEraseDemoVisitorTraegerMemberSQL)
		return err
	})
}

// repeatablePlatformEraseDemoVisitorTraegerMemberSQL removes the visitor from
// the Träger-Büro of the order's own Demo-Träger (#6193, ADR 0271). The seed
// lets the visitor's caregiver into that office under the visitor's name; the
// visit erasure (platform.erase_closed_demo_visitors) calls this before it
// checks whether the visitor's accounts belong anywhere else, so a membership
// of the visit never keeps an account from its erasure. It takes:
//   - the sessions and remembered devices of the Träger-Portal;
//   - the ledger entries of the office that the visitor made or that name the
//     visitor, among them the name the seed gave the membership;
//   - the Träger roles and the membership with its name.
//
// The Träger itself stays for its schools' database erasure. A NULL Träger
// (an order under the shared Demo-Träger) changes nothing. It runs inside the
// caller's subtransaction with the caller's rights.
const repeatablePlatformEraseDemoVisitorTraegerMemberSQL = `
	CREATE OR REPLACE FUNCTION platform.erase_demo_visitor_traeger_member(p_traeger_id BIGINT, p_account_ids BIGINT[])
	RETURNS VOID LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog
	AS $body$
	BEGIN
		IF p_traeger_id IS NULL OR cardinality(p_account_ids) = 0 THEN
			RETURN;
		END IF;
		DELETE FROM auth.tokens WHERE organization_id = p_traeger_id AND account_id = ANY (p_account_ids);
		DELETE FROM auth.mfa_trusted_devices WHERE organization_id = p_traeger_id AND account_id = ANY (p_account_ids);
		DELETE FROM audit.traeger_account_changes
		WHERE organization_id = p_traeger_id
			AND (actor_account_id = ANY (p_account_ids) OR target_account_id = ANY (p_account_ids));
		DELETE FROM auth.organization_account_roles WHERE organization_id = p_traeger_id AND account_id = ANY (p_account_ids);
		DELETE FROM platform.organization_accounts WHERE organization_id = p_traeger_id AND account_id = ANY (p_account_ids);
	END $body$;
	REVOKE ALL ON FUNCTION platform.erase_demo_visitor_traeger_member(BIGINT, BIGINT[]) FROM PUBLIC;
`
