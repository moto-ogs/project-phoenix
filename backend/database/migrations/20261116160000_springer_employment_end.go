package migrations

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/uptrace/bun"
)

const springerEmploymentEndVersion = "20261116160000"

func init() {
	MigrationRegistry.Register(&Migration{
		Version:     springerEmploymentEndVersion,
		Description: "Nach der letzten Blockung wird die Beschäftigung des Springers zur früheren Beschäftigung (#7197, ADR 0252)",
		DependsOn: []string{
			springerEmploymentVersion, // the pool's Einsatzorte and the windows
			traegerStaffImportTrailVersion,
		},
	})
	Migrations.MustRegister(springerEmploymentEndUp, springerEmploymentEndDown)
}

// springerEmploymentEndUpSQL lets the Worker end the employment of a
// Springer at a school after the school's last block (#7197, ADR 0252).
// Like the other pool functions, they run as their owner and answer only
// the school of the tenant transaction whose Träger holds the release.
//
//   - workforce.pool_due_exits lists the live employments the pool created
//     at the school that have no live block from p_today on: their last
//     block is over, or every block was lifted. Each row names the last
//     block day and who acts for the exit: the most recent blocking
//     Leitung that still works at the school, else the Springer's own
//     account and employment. With p_staff_record_id it
//     locks that record first, as the first block does, and answers only
//     for it: a block and an exit of one Springer wait for each other.
//   - workforce.pool_ended writes the end into the record's trail, kind
//     'ended' with the school and the acting account.
//
// workforce.pool_due_exits locks the record FOR NO KEY UPDATE, like
// workforce.pool_springer_identity (repeatable_workforce_pool_springer_identity.go).
const springerEmploymentEndUpSQL = `

ALTER TABLE workforce.staff_record_changes DROP CONSTRAINT chk_workforce_staff_record_changes_kind;
ALTER TABLE workforce.staff_record_changes ADD CONSTRAINT chk_workforce_staff_record_changes_kind
	CHECK (kind IN ('linked', 'not_chosen', 'changed', 'added', 'removed', 'imported', 'ended'));

CREATE FUNCTION workforce.pool_due_exits(p_today DATE, p_staff_record_id BIGINT DEFAULT NULL)
RETURNS TABLE(staff_record_id BIGINT, staff_id BIGINT, last_day DATE, actor_account_id BIGINT, actor_staff_id BIGINT)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
	v_school BIGINT := NULLIF(current_setting('app.current_tenant_id', true), '')::bigint;
	v_org BIGINT := workforce.pool_school_organization();
BEGIN
	IF v_org IS NULL OR p_today IS NULL THEN
		RETURN;
	END IF;
	IF p_staff_record_id IS NOT NULL THEN
		PERFORM FROM workforce.staff_records AS record
		WHERE record.organization_id = v_org AND record.id = p_staff_record_id FOR NO KEY UPDATE;
	END IF;
	RETURN QUERY
	SELECT link.staff_record_id, link.membership_id, span.last_day,
		COALESCE(actor.account_id, springer.account_id), COALESCE(actor.staff_id, CASE WHEN springer.account_id IS NOT NULL THEN link.membership_id END)
	FROM workforce.staff_record_links AS link
	JOIN users.staff_school_memberships AS membership
		ON membership.tenant_id = link.school_id AND membership.id = link.membership_id AND membership.deleted_at IS NULL
	JOIN users.persons AS springer ON springer.tenant_id = membership.tenant_id AND springer.id = membership.person_id
	CROSS JOIN LATERAL (
		SELECT max(block.date) FILTER (WHERE block.lifted_at IS NULL) AS live_day, max(block.date) AS any_day,
			COALESCE(max(block.date) FILTER (WHERE block.lifted_at IS NULL), max(block.date)) AS last_day
		FROM workforce.staff_pool_blocks AS block
		WHERE block.organization_id = link.organization_id AND block.staff_record_id = link.staff_record_id
		  AND block.school_id = link.school_id
	) AS span
	LEFT JOIN LATERAL (
		SELECT block.blocked_by_account_id AS account_id, lead.id AS staff_id
		FROM workforce.staff_pool_blocks AS block
		JOIN users.persons AS person
			ON person.tenant_id = link.school_id AND person.account_id = block.blocked_by_account_id
		JOIN users.staff_school_memberships AS lead
			ON lead.tenant_id = person.tenant_id AND lead.person_id = person.id AND lead.deleted_at IS NULL
		WHERE block.organization_id = link.organization_id AND block.staff_record_id = link.staff_record_id
		  AND block.school_id = link.school_id AND lead.id <> link.membership_id
		ORDER BY block.date DESC, block.blocked_at DESC, block.id DESC
		LIMIT 1
	) AS actor ON true
	WHERE link.organization_id = v_org AND link.school_id = v_school AND link.via_pool
	  AND (p_staff_record_id IS NULL OR link.staff_record_id = p_staff_record_id)
	  AND span.any_day IS NOT NULL
	  AND (span.live_day IS NULL OR span.live_day < p_today)
	ORDER BY link.staff_record_id;
END;
$$;
REVOKE ALL ON FUNCTION workforce.pool_due_exits(DATE, BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION workforce.pool_due_exits(DATE, BIGINT) TO phoenix_tenant;

-- workforce.pool_ended answers whether it wrote the end of the pool's
-- Einsatzort of the record at the school into the record's trail.
CREATE FUNCTION workforce.pool_ended(p_staff_record_id BIGINT, p_account_id BIGINT) RETURNS BOOLEAN
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
	v_school BIGINT := NULLIF(current_setting('app.current_tenant_id', true), '')::bigint;
	v_org BIGINT := workforce.pool_school_organization();
BEGIN
	IF v_org IS NULL OR NOT EXISTS (SELECT FROM workforce.staff_record_links AS link
		WHERE link.organization_id = v_org AND link.staff_record_id = p_staff_record_id
		  AND link.school_id = v_school AND link.via_pool) THEN
		RETURN false;
	END IF;
	INSERT INTO workforce.staff_record_changes (organization_id, staff_record_id, kind, field, school_id, account_id)
	VALUES (v_org, p_staff_record_id, 'ended', 'school', v_school, p_account_id);
	RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION workforce.pool_ended(BIGINT, BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION workforce.pool_ended(BIGINT, BIGINT) TO phoenix_tenant;
`

const springerEmploymentEndDownSQL = `
DROP FUNCTION IF EXISTS workforce.pool_ended(BIGINT, BIGINT);
DROP FUNCTION IF EXISTS workforce.pool_due_exits(DATE, BIGINT);
DELETE FROM workforce.staff_record_changes WHERE kind = 'ended';
ALTER TABLE workforce.staff_record_changes DROP CONSTRAINT chk_workforce_staff_record_changes_kind;
ALTER TABLE workforce.staff_record_changes ADD CONSTRAINT chk_workforce_staff_record_changes_kind
	CHECK (kind IN ('linked', 'not_chosen', 'changed', 'added', 'removed', 'imported'));
`

func springerEmploymentEndUp(ctx context.Context, db *bun.DB) error {
	return db.RunInTx(ctx, &sql.TxOptions{}, func(ctx context.Context, tx bun.Tx) error {
		if _, err := tx.ExecContext(ctx, springerEmploymentEndUpSQL); err != nil {
			return fmt.Errorf("add springer employment end: %w", err)
		}
		return nil
	})
}

func springerEmploymentEndDown(ctx context.Context, db *bun.DB) error {
	return db.RunInTx(ctx, &sql.TxOptions{}, func(ctx context.Context, tx bun.Tx) error {
		if _, err := tx.ExecContext(ctx, springerEmploymentEndDownSQL); err != nil {
			return fmt.Errorf("drop springer employment end: %w", err)
		}
		return nil
	})
}
