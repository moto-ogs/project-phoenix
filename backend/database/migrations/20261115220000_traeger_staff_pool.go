package migrations

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/uptrace/bun"
)

const traegerStaffPoolVersion = "20261115220000"

func init() {
	MigrationRegistry.Register(&Migration{
		Version:     traegerStaffPoolVersion,
		Description: "Vertretungspool des Trägers: Springer und ihre Blockungen durch die Schulen (#4709, ADR 0089 §9)",
		DependsOn: []string{
			traegerStaffContractsVersion,        // the Arbeitsvertrag that carries the Merkmal „Vertretungspool“
			traegerStaffProofsVersion,           // the Nachweise a school sees of a Springer
			requestChildOfferingValidityVersion, // btree_gist, which the exclusion constraint needs for staff_record_id WITH =
		},
	})
	Migrations.MustRegister(traegerStaffPoolUp, traegerStaffPoolDown)
}

// traegerStaffPoolUpSQL adds the Vertretungspool of ADR 0089 section 9
// (#4709, ADR 0250).
//
//   - workforce.staff_contracts.pool marks a contract of the pool. Its
//     person is a Springer whom every school of the Träger may block.
//   - workforce.staff_pool_blocks is one block of a Springer by one school:
//     a day with a start and an end. The exclusion constraint keeps two live
//     blocks of one Springer from overlapping. Two schools that block at the
//     same moment wait for each other at the constraint; the second one gets
//     the exclusion violation, which moto answers with a clear message. A
//     lifted block stays with who lifted it, so the school sees that the
//     Personalverwaltung lifted it.
//
// The school's role reads no Träger table. Like the proof status (#4707),
// the school reads the pool through functions that run as their owner and
// answer only the school of the tenant transaction, and only when its
// Träger holds the release „Personal beim Träger“:
//
//   - workforce.pool_springers lists the Springer whose pool contract runs
//     in [p_from, p_to], with the first and last day of the pool contracts.
//   - workforce.pool_blocks lists the live blocks of those days, the lifted
//     blocks of the own school, and names the blocking school. Another
//     school's block carries no id; nothing about why or for which group a
//     school blocked is stored at all.
//   - workforce.pool_proof_status gives the status of the Nachweise of the
//     Springer: kind, mandatory, held and expiry, nothing of the proof itself.
//   - workforce.pool_block blocks a Springer for the school; workforce.pool_lift
//     lifts one of the school's own blocks.
const traegerStaffPoolUpSQL = `
ALTER TABLE workforce.staff_contracts ADD COLUMN pool BOOLEAN NOT NULL DEFAULT false;
COMMENT ON COLUMN workforce.staff_contracts.pool IS
	'Merkmal „Vertretungspool“ (#4709, ADR 0089 section 9): the person of this contract is a Springer every school of the Träger may block.';

CREATE TABLE workforce.staff_pool_blocks (
	id BIGSERIAL PRIMARY KEY,
	organization_id BIGINT NOT NULL,
	staff_record_id BIGINT NOT NULL,
	school_id BIGINT NOT NULL,
	date DATE NOT NULL,
	start_time TIME WITHOUT TIME ZONE NOT NULL,
	end_time TIME WITHOUT TIME ZONE NOT NULL,
	blocked_by_account_id BIGINT NOT NULL,
	blocked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
	lifted_at TIMESTAMPTZ,
	lifted_by_account_id BIGINT,
	lifted_by_traeger BOOLEAN NOT NULL DEFAULT false,
	CONSTRAINT fk_workforce_staff_pool_blocks_record FOREIGN KEY (organization_id, staff_record_id)
		REFERENCES workforce.staff_records (organization_id, id) ON DELETE CASCADE,
	CONSTRAINT chk_workforce_staff_pool_blocks_times CHECK (end_time > start_time),
	CONSTRAINT chk_workforce_staff_pool_blocks_lifted CHECK ((lifted_at IS NULL) = (lifted_by_account_id IS NULL)),
	CONSTRAINT ex_workforce_staff_pool_blocks_overlap EXCLUDE USING gist (
		staff_record_id WITH =,
		tsrange(date + start_time, date + end_time) WITH &&
	) WHERE (lifted_at IS NULL)
);
CREATE INDEX idx_workforce_staff_pool_blocks_organization ON workforce.staff_pool_blocks (organization_id, date);
CREATE INDEX idx_workforce_staff_pool_blocks_school ON workforce.staff_pool_blocks (school_id, date);
COMMENT ON TABLE workforce.staff_pool_blocks IS
	'Blockung eines Springers durch eine Schule (#4709, ADR 0089 section 9): Tag, Beginn und Ende, ohne Grund und ohne Gruppe. Live Blockungen eines Springers überschneiden sich nie.';

ALTER TABLE workforce.staff_pool_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE workforce.staff_pool_blocks FORCE ROW LEVEL SECURITY;
CREATE POLICY traeger_isolation_workforce_staff_pool_blocks ON workforce.staff_pool_blocks FOR ALL
	USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::bigint)
	WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::bigint);

-- The Träger of the school of the tenant transaction, if it holds the
-- release „Personal beim Träger“; NULL otherwise and outside a tenant
-- transaction.
CREATE FUNCTION workforce.pool_school_organization() RETURNS BIGINT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
	SELECT school.organization_id
	FROM platform.schools AS school
	JOIN workforce.staff_releases AS release ON release.organization_id = school.organization_id
	WHERE school.id = NULLIF(current_setting('app.current_tenant_id', true), '')::bigint
	  AND school.deleted_at IS NULL
$$;
REVOKE ALL ON FUNCTION workforce.pool_school_organization() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION workforce.pool_school_organization() TO phoenix_tenant;

CREATE FUNCTION workforce.pool_springers(p_from DATE, p_to DATE)
RETURNS TABLE (staff_record_id BIGINT, first_name VARCHAR, last_name VARCHAR, pool_from DATE, pool_until DATE)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
	SELECT record.id, record.first_name, record.last_name, min(contract.starts_on),
		CASE WHEN bool_or(contract.ends_on IS NULL) THEN NULL ELSE max(contract.ends_on) END
	FROM workforce.staff_records AS record
	JOIN workforce.staff_contracts AS contract
		ON contract.organization_id = record.organization_id AND contract.staff_record_id = record.id AND contract.pool
	WHERE record.organization_id = workforce.pool_school_organization()
	  AND contract.starts_on <= p_to AND (contract.ends_on IS NULL OR contract.ends_on >= p_from)
	GROUP BY record.id, record.first_name, record.last_name
$$;
REVOKE ALL ON FUNCTION workforce.pool_springers(DATE, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION workforce.pool_springers(DATE, DATE) TO phoenix_tenant;

CREATE FUNCTION workforce.pool_blocks(p_staff_record_ids BIGINT[], p_from DATE, p_to DATE)
RETURNS TABLE (id BIGINT, staff_record_id BIGINT, school_id BIGINT, school_name VARCHAR, own BOOLEAN, date DATE,
	start_time TIME WITHOUT TIME ZONE, end_time TIME WITHOUT TIME ZONE, lifted BOOLEAN)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
	SELECT CASE WHEN block.school_id = v.school THEN block.id END, block.staff_record_id, block.school_id, school.name,
		block.school_id = v.school, block.date, block.start_time, block.end_time, block.lifted_at IS NOT NULL
	FROM (SELECT NULLIF(current_setting('app.current_tenant_id', true), '')::bigint AS school,
		workforce.pool_school_organization() AS organization) AS v
	JOIN workforce.staff_pool_blocks AS block ON block.organization_id = v.organization
	LEFT JOIN platform.schools AS school ON school.id = block.school_id
	WHERE block.staff_record_id = ANY(p_staff_record_ids)
	  AND block.date BETWEEN p_from AND p_to
	  AND (block.lifted_at IS NULL OR (block.school_id = v.school AND block.lifted_by_traeger))
	  AND EXISTS (SELECT FROM workforce.staff_contracts AS contract
		WHERE contract.organization_id = block.organization_id AND contract.staff_record_id = block.staff_record_id AND contract.pool)
$$;
REVOKE ALL ON FUNCTION workforce.pool_blocks(BIGINT[], DATE, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION workforce.pool_blocks(BIGINT[], DATE, DATE) TO phoenix_tenant;

CREATE FUNCTION workforce.pool_proof_status(p_staff_record_ids BIGINT[])
RETURNS TABLE (staff_record_id BIGINT, type_name VARCHAR, mandatory BOOLEAN, held BOOLEAN, expires_on TEXT, reminder_lead_weeks INTEGER)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
	SELECT record.id, kind.name, kind.mandatory, proof.id IS NOT NULL, proof.expires_on::text, kind.reminder_lead_weeks
	FROM workforce.staff_records AS record
	JOIN workforce.staff_proof_types AS kind ON kind.organization_id = record.organization_id AND kind.archived_at IS NULL
	LEFT JOIN workforce.staff_proofs AS proof
		ON proof.organization_id = record.organization_id AND proof.staff_record_id = record.id AND proof.type_id = kind.id
	WHERE record.organization_id = workforce.pool_school_organization()
	  AND record.id = ANY(p_staff_record_ids)
	  AND EXISTS (SELECT FROM workforce.staff_contracts AS contract
		WHERE contract.organization_id = record.organization_id AND contract.staff_record_id = record.id AND contract.pool)
	  AND (kind.mandatory OR proof.id IS NOT NULL)
	ORDER BY record.id, kind.sort_order, kind.id
$$;
REVOKE ALL ON FUNCTION workforce.pool_proof_status(BIGINT[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION workforce.pool_proof_status(BIGINT[]) TO phoenix_tenant;

-- workforce.pool_block blocks a Springer for the school of the tenant
-- transaction. It raises no_data_found when the person is no Springer of
-- the school's Träger on that day, and WFP01 when the person has a shift at
-- one of its Einsatzorte at that time; an overlap with a live block of any
-- school raises the exclusion violation of the table.
CREATE FUNCTION workforce.pool_block(p_staff_record_id BIGINT, p_date DATE, p_start TIME WITHOUT TIME ZONE,
	p_end TIME WITHOUT TIME ZONE, p_account_id BIGINT) RETURNS BIGINT
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
	v_school BIGINT := NULLIF(current_setting('app.current_tenant_id', true), '')::bigint;
	v_org BIGINT := workforce.pool_school_organization();
	v_id BIGINT;
BEGIN
	IF v_org IS NULL OR NOT EXISTS (SELECT FROM workforce.staff_contracts AS contract
		WHERE contract.organization_id = v_org AND contract.staff_record_id = p_staff_record_id AND contract.pool
		  AND contract.starts_on <= p_date AND (contract.ends_on IS NULL OR contract.ends_on >= p_date)) THEN
		RAISE EXCEPTION 'workforce.pool_block: no Springer of the Träger on this day' USING ERRCODE = 'no_data_found';
	END IF;
	IF EXISTS (SELECT FROM workforce.staff_record_links AS link
		JOIN schedule.staff_shifts AS shift ON shift.tenant_id = link.school_id AND shift.staff_id = link.membership_id
		WHERE link.organization_id = v_org AND link.staff_record_id = p_staff_record_id
		  AND NOT shift.cancelled AND shift.date = p_date
		  AND shift.start_time < p_end AND shift.end_time > p_start) THEN
		RAISE EXCEPTION 'workforce.pool_block: the Springer works a shift at this time' USING ERRCODE = 'WFP01';
	END IF;
	INSERT INTO workforce.staff_pool_blocks (organization_id, staff_record_id, school_id, date, start_time, end_time, blocked_by_account_id)
	VALUES (v_org, p_staff_record_id, v_school, p_date, p_start, p_end, p_account_id)
	RETURNING id INTO v_id;
	RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION workforce.pool_block(BIGINT, DATE, TIME WITHOUT TIME ZONE, TIME WITHOUT TIME ZONE, BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION workforce.pool_block(BIGINT, DATE, TIME WITHOUT TIME ZONE, TIME WITHOUT TIME ZONE, BIGINT) TO phoenix_tenant;

-- workforce.pool_lift lifts a live block of the school of the tenant
-- transaction and answers whether there was one.
CREATE FUNCTION workforce.pool_lift(p_block_id BIGINT, p_account_id BIGINT) RETURNS BOOLEAN
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
	WITH lifted AS (
		UPDATE workforce.staff_pool_blocks SET lifted_at = now(), lifted_by_account_id = p_account_id
		WHERE id = p_block_id AND lifted_at IS NULL
		  AND school_id = NULLIF(current_setting('app.current_tenant_id', true), '')::bigint
		  AND organization_id = workforce.pool_school_organization()
		RETURNING id)
	SELECT EXISTS (SELECT FROM lifted)
$$;
REVOKE ALL ON FUNCTION workforce.pool_lift(BIGINT, BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION workforce.pool_lift(BIGINT, BIGINT) TO phoenix_tenant;

-- The Träger transaction runs as phoenix_tenant: it reads the blocks of its
-- Träger and lifts one, nothing else. The school writes only through the
-- functions above.
REVOKE ALL ON workforce.staff_pool_blocks FROM PUBLIC;
GRANT SELECT ON workforce.staff_pool_blocks TO phoenix_tenant;
GRANT UPDATE (lifted_at, lifted_by_account_id, lifted_by_traeger) ON workforce.staff_pool_blocks TO phoenix_tenant;
GRANT ALL ON workforce.staff_pool_blocks TO phoenix_admin;
GRANT USAGE ON SEQUENCE workforce.staff_pool_blocks_id_seq TO phoenix_admin;
`

const traegerStaffPoolDownSQL = `
DROP FUNCTION IF EXISTS workforce.pool_lift(BIGINT, BIGINT);
DROP FUNCTION IF EXISTS workforce.pool_block(BIGINT, DATE, TIME WITHOUT TIME ZONE, TIME WITHOUT TIME ZONE, BIGINT);
DROP FUNCTION IF EXISTS workforce.pool_proof_status(BIGINT[]);
DROP FUNCTION IF EXISTS workforce.pool_blocks(BIGINT[], DATE, DATE);
DROP FUNCTION IF EXISTS workforce.pool_springers(DATE, DATE);
DROP FUNCTION IF EXISTS workforce.pool_school_organization();
DROP TABLE IF EXISTS workforce.staff_pool_blocks;
ALTER TABLE workforce.staff_contracts DROP COLUMN IF EXISTS pool;
`

func traegerStaffPoolUp(ctx context.Context, db *bun.DB) error {
	return db.RunInTx(ctx, &sql.TxOptions{}, func(ctx context.Context, tx bun.Tx) error {
		if _, err := tx.ExecContext(ctx, traegerStaffPoolUpSQL); err != nil {
			return fmt.Errorf("add traeger staff pool: %w", err)
		}
		return nil
	})
}

func traegerStaffPoolDown(ctx context.Context, db *bun.DB) error {
	return db.RunInTx(ctx, &sql.TxOptions{}, func(ctx context.Context, tx bun.Tx) error {
		if _, err := tx.ExecContext(ctx, traegerStaffPoolDownSQL); err != nil {
			return fmt.Errorf("drop traeger staff pool: %w", err)
		}
		return nil
	})
}
