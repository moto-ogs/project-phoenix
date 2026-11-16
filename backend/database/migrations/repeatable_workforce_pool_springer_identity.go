package migrations

import (
	"context"

	"github.com/uptrace/bun"
)

func init() {
	RegisterRepeatable("workforce.pool_springer_identity", func(ctx context.Context, tx bun.Tx) error {
		_, err := tx.ExecContext(ctx, repeatableWorkforcePoolSpringerIdentitySQL)
		return err
	})
}

// repeatableWorkforcePoolSpringerIdentitySQL is the current definition of
// workforce.pool_springer_identity(bigint) (ADR 0223, first in migration
// 20261115230000). Change the function here.
//
// It locks the record FOR NO KEY UPDATE (#7197). A block inserts its row
// first, and the foreign key takes KEY SHARE on the record. FOR UPDATE then
// waited for the KEY SHARE of a second first block of the same Springer,
// which waited for the first one's: a deadlock. NO KEY UPDATE coexists with
// KEY SHARE and still serializes two blocks and an exit of one Springer.
const repeatableWorkforcePoolSpringerIdentitySQL = `
CREATE OR REPLACE FUNCTION workforce.pool_springer_identity(p_staff_record_id BIGINT)
RETURNS TABLE(account_id BIGINT, first_name TEXT, last_name TEXT, membership_id BIGINT, membership_live BOOLEAN, via_pool BOOLEAN)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
	v_school BIGINT := NULLIF(current_setting('app.current_tenant_id', true), '')::bigint;
	v_org BIGINT := workforce.pool_school_organization();
BEGIN
	IF v_org IS NULL OR NOT EXISTS (SELECT FROM workforce.staff_contracts AS contract
		WHERE contract.organization_id = v_org AND contract.staff_record_id = p_staff_record_id AND contract.pool) THEN
		RETURN;
	END IF;
	PERFORM FROM workforce.staff_records AS record
	WHERE record.organization_id = v_org AND record.id = p_staff_record_id FOR NO KEY UPDATE;
	RETURN QUERY
	SELECT
		(SELECT person.account_id FROM workforce.staff_record_links AS link
			JOIN users.staff_school_memberships AS membership ON membership.tenant_id = link.school_id AND membership.id = link.membership_id
			JOIN users.persons AS person ON person.tenant_id = membership.tenant_id AND person.id = membership.person_id
			WHERE link.organization_id = v_org AND link.staff_record_id = p_staff_record_id AND person.account_id IS NOT NULL
			ORDER BY (membership.deleted_at IS NULL) DESC, link.via_pool, link.linked_at, link.id
			LIMIT 1),
		record.first_name::text, record.last_name::text,
		own.membership_id, own.live, own.via_pool
	FROM workforce.staff_records AS record
	LEFT JOIN LATERAL (
		SELECT link.membership_id, (membership.id IS NOT NULL AND membership.deleted_at IS NULL) AS live, link.via_pool
		FROM workforce.staff_record_links AS link
		LEFT JOIN users.staff_school_memberships AS membership ON membership.tenant_id = link.school_id AND membership.id = link.membership_id
		WHERE link.organization_id = v_org AND link.staff_record_id = record.id AND link.school_id = v_school
	) AS own ON true
	WHERE record.organization_id = v_org AND record.id = p_staff_record_id;
END;
$$;
`
