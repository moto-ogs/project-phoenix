package migrations

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/uptrace/bun"
)

const springerEmploymentVersion = "20261115230000"

// springerRoleName mirrors identityaccess.SpringerRoleName; migrations
// cannot import modules, so keep both in sync by hand.
const springerRoleName = "springer"

func init() {
	MigrationRegistry.Register(&Migration{
		Version:     springerEmploymentVersion,
		Description: "Erstes Blocken legt die Beschäftigung des Springers an; Zugang nur in Zeitfenstern (#7173, ADR 0251)",
		DependsOn: []string{
			traegerStaffPoolVersion, // the blocks the windows come from
			authTenantRLSVersion,    // the tenant isolation the account mapping already has
			agLeitungRoleVersion,    // the shape of a platform system role with base role user
		},
	})
	Migrations.MustRegister(springerEmploymentUp, springerEmploymentDown)
}

// springerEmploymentUpSQL adds what the first block of a Springer creates
// at the blocking school (#7173, ADR 0251).
//
// Identity & Access:
//   - auth.account_tenants.access_windows holds the windows of the mapping,
//     keyed by block: a block with its margin. Lifting the block removes it.
//     The windows stay on the mapping row, so they go with the school's
//     erasure and the account's mappings without a table of their own.
//   - auth.account_tenant_admitted answers whether a mapping admits the
//     account now. It refuses only an account whose roles at the school are
//     the system role springer, besides guardian at most, while no window is
//     open. Any other role grants unlimited access, however it came.
//     Sign-in, session renewal and the per-request session check read it.
//   - The platform system role springer holds time_tracking:own only.
//
// Workforce:
//   - workforce.staff_record_links.via_pool marks an Einsatzort the pool
//     created, so a later block may move it to a resumed employment.
//   - workforce.pool_springer_identity locks the record of a Springer and
//     then reads the account behind its employments, its names and its
//     Einsatzort at the school of the tenant transaction. The lock makes two
//     first blocks of one Springer wait for each other.
//   - workforce.pool_link links a live employment of the school as an
//     Einsatzort of the record and writes the link into the record's trail.
const springerEmploymentUpSQL = `
ALTER TABLE auth.account_tenants ADD COLUMN access_windows JSONB NOT NULL DEFAULT '{}'::jsonb
	CONSTRAINT chk_auth_account_tenants_access_windows CHECK (jsonb_typeof(access_windows) = 'object');
COMMENT ON COLUMN auth.account_tenants.access_windows IS
	'Open and coming windows of a Springer at the school, keyed by Vertretungspool block id: [starts_at, ends_at] (#7173, ADR 0251).';

CREATE FUNCTION auth.account_tenant_admitted(p_account_id BIGINT, p_tenant_id BIGINT) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
	SELECT NOT EXISTS (SELECT FROM auth.account_roles AS held JOIN auth.roles AS role ON role.id = held.role_id
			WHERE held.account_id = p_account_id AND held.tenant_id = p_tenant_id
			  AND role.tenant_id IS NULL AND role.name = '` + springerRoleName + `')
		OR EXISTS (SELECT FROM auth.account_roles AS held JOIN auth.roles AS role ON role.id = held.role_id
			WHERE held.account_id = p_account_id AND held.tenant_id = p_tenant_id
			  AND NOT (role.tenant_id IS NULL AND role.name IN ('` + springerRoleName + `', 'guardian')))
		OR EXISTS (SELECT FROM auth.account_tenants AS mapping, jsonb_each(mapping.access_windows) AS slot(block_id, span)
			WHERE mapping.account_id = p_account_id AND mapping.tenant_id = p_tenant_id
			  AND (slot.span->>0)::timestamptz <= now() AND (slot.span->>1)::timestamptz > now())
$$;
REVOKE ALL ON FUNCTION auth.account_tenant_admitted(BIGINT, BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth.account_tenant_admitted(BIGINT, BIGINT) TO phoenix_tenant, phoenix_auth, phoenix_admin;

INSERT INTO auth.roles (name, description, is_system, base_role, tenant_id)
SELECT '` + springerRoleName + `', 'Springer aus dem Vertretungspool: eigener Dienstplan und Stempeln, nur in den geblockten Zeiten', TRUE, 'user', NULL
WHERE NOT EXISTS (SELECT 1 FROM auth.roles WHERE name = '` + springerRoleName + `' AND tenant_id IS NULL);
INSERT INTO auth.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM auth.roles r CROSS JOIN auth.permissions p
WHERE r.name = '` + springerRoleName + `' AND r.tenant_id IS NULL AND p.name = 'time_tracking:own'
ON CONFLICT (role_id, permission_id) DO NOTHING;

ALTER TABLE workforce.staff_record_links ADD COLUMN via_pool BOOLEAN NOT NULL DEFAULT false;
COMMENT ON COLUMN workforce.staff_record_links.via_pool IS
	'The first block of a Springer created this Einsatzort (#7173, ADR 0251).';

CREATE FUNCTION workforce.pool_springer_identity(p_staff_record_id BIGINT)
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
	WHERE record.organization_id = v_org AND record.id = p_staff_record_id FOR UPDATE;
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
REVOKE ALL ON FUNCTION workforce.pool_springer_identity(BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION workforce.pool_springer_identity(BIGINT) TO phoenix_tenant;

-- workforce.pool_link raises no_data_found unless the record is a Springer
-- of the school's Träger and the membership a live employment of the
-- school whose person has the account of one of the record's employments. An Einsatzort the Personalverwaltung linked stays as it is.
CREATE FUNCTION workforce.pool_link(p_staff_record_id BIGINT, p_membership_id BIGINT, p_account_id BIGINT) RETURNS BOOLEAN
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
	v_school BIGINT := NULLIF(current_setting('app.current_tenant_id', true), '')::bigint;
	v_org BIGINT := workforce.pool_school_organization();
	v_linked BIGINT;
BEGIN
	IF v_org IS NULL OR NOT EXISTS (SELECT FROM workforce.staff_contracts AS contract
		WHERE contract.organization_id = v_org AND contract.staff_record_id = p_staff_record_id AND contract.pool)
	   OR NOT EXISTS (SELECT FROM users.staff_school_memberships AS membership
		JOIN users.persons AS person ON person.tenant_id = membership.tenant_id AND person.id = membership.person_id
		WHERE membership.tenant_id = v_school AND membership.id = p_membership_id AND membership.deleted_at IS NULL
		  AND person.account_id IN (SELECT known.account_id FROM workforce.staff_record_links AS link
			JOIN users.staff_school_memberships AS employment ON employment.tenant_id = link.school_id AND employment.id = link.membership_id
			JOIN users.persons AS known ON known.tenant_id = employment.tenant_id AND known.id = employment.person_id
			WHERE link.organization_id = v_org AND link.staff_record_id = p_staff_record_id)) THEN
		RAISE EXCEPTION 'workforce.pool_link: no Springer or no live employment of theirs at the school' USING ERRCODE = 'no_data_found';
	END IF;
	INSERT INTO workforce.staff_record_links AS link (organization_id, staff_record_id, school_id, membership_id, linked_by_account_id, via_pool)
	VALUES (v_org, p_staff_record_id, v_school, p_membership_id, p_account_id, true)
	ON CONFLICT (staff_record_id, school_id) DO UPDATE
		SET membership_id = EXCLUDED.membership_id, linked_by_account_id = EXCLUDED.linked_by_account_id, linked_at = now()
		WHERE link.via_pool AND link.membership_id <> EXCLUDED.membership_id
	RETURNING link.id INTO v_linked;
	IF v_linked IS NULL THEN
		RETURN false;
	END IF;
	INSERT INTO workforce.staff_record_changes (organization_id, staff_record_id, kind, field, school_id, account_id)
	VALUES (v_org, p_staff_record_id, 'linked', 'school', v_school, p_account_id);
	RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION workforce.pool_link(BIGINT, BIGINT, BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION workforce.pool_link(BIGINT, BIGINT, BIGINT) TO phoenix_tenant;
`

const springerEmploymentDownSQL = `
DROP FUNCTION IF EXISTS workforce.pool_link(BIGINT, BIGINT, BIGINT);
DROP FUNCTION IF EXISTS workforce.pool_springer_identity(BIGINT);
ALTER TABLE workforce.staff_record_links DROP COLUMN IF EXISTS via_pool;
DELETE FROM auth.invitation_tokens WHERE role_id IN (SELECT id FROM auth.roles WHERE name = '` + springerRoleName + `' AND tenant_id IS NULL);
DELETE FROM auth.account_roles WHERE role_id IN (SELECT id FROM auth.roles WHERE name = '` + springerRoleName + `' AND tenant_id IS NULL);
DELETE FROM auth.role_permissions WHERE role_id IN (SELECT id FROM auth.roles WHERE name = '` + springerRoleName + `' AND tenant_id IS NULL);
DELETE FROM auth.roles WHERE name = '` + springerRoleName + `' AND tenant_id IS NULL;
DROP FUNCTION IF EXISTS auth.account_tenant_admitted(BIGINT, BIGINT);
ALTER TABLE auth.account_tenants DROP COLUMN IF EXISTS access_windows;
`

func springerEmploymentUp(ctx context.Context, db *bun.DB) error {
	return db.RunInTx(ctx, &sql.TxOptions{}, func(ctx context.Context, tx bun.Tx) error {
		if _, err := tx.ExecContext(ctx, springerEmploymentUpSQL); err != nil {
			return fmt.Errorf("add springer employment: %w", err)
		}
		return nil
	})
}

func springerEmploymentDown(ctx context.Context, db *bun.DB) error {
	return db.RunInTx(ctx, &sql.TxOptions{}, func(ctx context.Context, tx bun.Tx) error {
		if _, err := tx.ExecContext(ctx, springerEmploymentDownSQL); err != nil {
			return fmt.Errorf("drop springer employment: %w", err)
		}
		return nil
	})
}
