package migrations

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/uptrace/bun"
)

const traegerSchoolRolesVersion = "20261124140000"

func init() {
	MigrationRegistry.Register(&Migration{
		Version:     traegerSchoolRolesVersion,
		Description: "Rollen des Trägers für das Personal aller seiner Schulen (#4810, ADR 0317)",
		DependsOn: []string{
			"1.15.480",            // auth.roles.school_portal, the last change of auth.roles
			traegerCatalogVersion, // the other trigger on platform.schools.organization_id
		},
	})
	Migrations.MustRegister(traegerSchoolRolesUp, traegerSchoolRolesDown)
}

// traegerSchoolRolesUpSQL adds the roles a Träger gives the staff of all its
// schools (#4810, ADR 0317).
//
//   - auth.traeger_school_roles is the role as the Träger-Büro keeps it: a
//     name as the office spelled it (unique without regard to case; the
//     copy carries it in lower case, as every school role name is stored),
//     a description, the tier it counts as and, in
//     auth.traeger_school_role_permissions, its rights from the school's
//     catalogue. Both are written in the Träger transaction only.
//   - auth.roles.traeger_role_id marks the copy of such a role at a school.
//     The copy is an ordinary school role: assignments, sign-in and renewal
//     read it unchanged. Identity & Access writes it in the school's tenant
//     transaction and refuses the school's own edits.
//   - auth.carry_traeger_school_roles gives a school that joins a Träger the
//     copies of that Träger's roles in the statement that creates or moves
//     it, so no later school waits for the next change at the Träger-Büro. A
//     school that leaves a Träger keeps its copies as ordinary roles of its
//     own (as ADR 0195 section 8 does for phases and offerings): nobody loses
//     a right through the move. A name the school already uses stays the
//     school's; the Träger-Büro sees the role as not carried there.
//   - auth.release_traeger_school_role_copies keeps every copy pointing at
//     a role that exists: when a Träger role goes, a copy its removal did not
//     reach becomes a role of the school's own.
const traegerSchoolRolesUpSQL = `
CREATE TABLE auth.traeger_school_roles (
	id BIGSERIAL PRIMARY KEY,
	organization_id BIGINT NOT NULL REFERENCES platform.organizations(id) ON DELETE CASCADE,
	name TEXT NOT NULL,
	description TEXT NOT NULL DEFAULT '',
	base_role VARCHAR NOT NULL,
	created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
	updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
	CONSTRAINT uq_traeger_school_roles_organization_id UNIQUE (organization_id, id),
	CONSTRAINT chk_traeger_school_roles_name CHECK (btrim(name) <> ''),
	CONSTRAINT chk_traeger_school_roles_base_role CHECK (base_role IN ('admin', 'user'))
);
CREATE UNIQUE INDEX uq_traeger_school_roles_name ON auth.traeger_school_roles (organization_id, lower(name));
COMMENT ON TABLE auth.traeger_school_roles IS
	'Role a Träger gives the staff of all its schools (#4810, ADR 0317): copied into every school of the Träger as a row of auth.roles that names it.';

CREATE TABLE auth.traeger_school_role_permissions (
	organization_id BIGINT NOT NULL,
	traeger_role_id BIGINT NOT NULL,
	permission_id BIGINT NOT NULL REFERENCES auth.permissions(id) ON DELETE CASCADE,
	PRIMARY KEY (traeger_role_id, permission_id),
	CONSTRAINT fk_traeger_school_role_permissions_role FOREIGN KEY (organization_id, traeger_role_id)
		REFERENCES auth.traeger_school_roles (organization_id, id) ON DELETE CASCADE
);
CREATE INDEX idx_traeger_school_role_permissions_permission ON auth.traeger_school_role_permissions (permission_id);
COMMENT ON TABLE auth.traeger_school_role_permissions IS
	'Rights of a Träger role (#4810): permissions of the school catalogue, without the reserved platform permissions.';

CREATE TRIGGER trg_traeger_school_roles_updated_at BEFORE UPDATE ON auth.traeger_school_roles
	FOR EACH ROW EXECUTE FUNCTION update_modified_column();

ALTER TABLE auth.traeger_school_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth.traeger_school_roles FORCE ROW LEVEL SECURITY;
CREATE POLICY traeger_isolation_auth_traeger_school_roles ON auth.traeger_school_roles FOR ALL
	USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::bigint)
	WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::bigint);

ALTER TABLE auth.traeger_school_role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth.traeger_school_role_permissions FORCE ROW LEVEL SECURITY;
CREATE POLICY traeger_isolation_auth_traeger_school_role_permissions ON auth.traeger_school_role_permissions FOR ALL
	USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::bigint)
	WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::bigint);

REVOKE ALL ON auth.traeger_school_roles, auth.traeger_school_role_permissions FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON auth.traeger_school_roles, auth.traeger_school_role_permissions TO phoenix_tenant;
GRANT USAGE ON SEQUENCE auth.traeger_school_roles_id_seq TO phoenix_tenant;
GRANT ALL ON auth.traeger_school_roles, auth.traeger_school_role_permissions TO phoenix_admin;
GRANT USAGE ON SEQUENCE auth.traeger_school_roles_id_seq TO phoenix_admin;

ALTER TABLE auth.roles
	ADD COLUMN traeger_role_id BIGINT,
	-- Only a school's own role is the copy of a Träger role.
	ADD CONSTRAINT chk_roles_traeger_role_is_school_role CHECK (
		traeger_role_id IS NULL OR (tenant_id IS NOT NULL AND NOT is_system));
CREATE UNIQUE INDEX uq_roles_traeger_role ON auth.roles (tenant_id, traeger_role_id) WHERE traeger_role_id IS NOT NULL;
COMMENT ON COLUMN auth.roles.traeger_role_id IS
	'The Träger role this school role is the copy of (#4810); by plain id like the other Träger references. The school assigns such a role but does not change or delete it.';

CREATE FUNCTION auth.carry_traeger_school_roles()
	RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
	BEGIN
		IF TG_OP = 'UPDATE' THEN
			UPDATE auth.roles SET traeger_role_id = NULL
				WHERE tenant_id = NEW.id AND traeger_role_id IS NOT NULL;
		END IF;
		WITH carried AS (
			INSERT INTO auth.roles (tenant_id, name, description, base_role, is_system, traeger_role_id)
			SELECT NEW.id, lower(source.name), source.description, source.base_role, FALSE, source.id
			FROM auth.traeger_school_roles AS source
			WHERE source.organization_id = NEW.organization_id
			  AND NOT EXISTS (
				SELECT FROM auth.roles AS own WHERE own.tenant_id = NEW.id AND own.name = lower(source.name))
			RETURNING id, traeger_role_id
		)
		INSERT INTO auth.role_permissions (role_id, permission_id)
		SELECT carried.id, selection.permission_id
		FROM carried
		JOIN auth.traeger_school_role_permissions AS selection ON selection.traeger_role_id = carried.traeger_role_id;
		RETURN NULL;
	END; $$;
-- A removed Träger role leaves no copy that names it: a copy the removal did
-- not reach (a school deleted for now, a school created meanwhile, a Träger
-- erased with its roles) becomes a role of the school's own, which the school
-- may change again. It runs as its owner because the Träger transaction sees
-- no school's roles.
CREATE FUNCTION auth.release_traeger_school_role_copies()
	RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
	BEGIN
		UPDATE auth.roles SET traeger_role_id = NULL WHERE traeger_role_id = OLD.id;
		RETURN NULL;
	END; $$;
REVOKE ALL ON FUNCTION auth.release_traeger_school_role_copies() FROM PUBLIC;
CREATE TRIGGER release_traeger_school_role_copies
	AFTER DELETE ON auth.traeger_school_roles
	FOR EACH ROW EXECUTE FUNCTION auth.release_traeger_school_role_copies();
CREATE INDEX idx_roles_traeger_role ON auth.roles (traeger_role_id) WHERE traeger_role_id IS NOT NULL;

CREATE TRIGGER carry_traeger_school_roles_on_insert
	AFTER INSERT ON platform.schools
	FOR EACH ROW EXECUTE FUNCTION auth.carry_traeger_school_roles();
CREATE TRIGGER carry_traeger_school_roles_on_move
	AFTER UPDATE OF organization_id ON platform.schools
	FOR EACH ROW WHEN (OLD.organization_id IS DISTINCT FROM NEW.organization_id)
	EXECUTE FUNCTION auth.carry_traeger_school_roles();
`

const traegerSchoolRolesDownSQL = `
DROP TRIGGER release_traeger_school_role_copies ON auth.traeger_school_roles;
DROP FUNCTION auth.release_traeger_school_role_copies();
DROP INDEX auth.idx_roles_traeger_role;
DROP TRIGGER carry_traeger_school_roles_on_move ON platform.schools;
DROP TRIGGER carry_traeger_school_roles_on_insert ON platform.schools;
DROP FUNCTION auth.carry_traeger_school_roles();
DROP INDEX auth.uq_roles_traeger_role;
ALTER TABLE auth.roles
	DROP CONSTRAINT chk_roles_traeger_role_is_school_role,
	DROP COLUMN traeger_role_id;
DROP TABLE auth.traeger_school_role_permissions;
DROP TABLE auth.traeger_school_roles;
`

func traegerSchoolRolesUp(ctx context.Context, db *bun.DB) error {
	return db.RunInTx(ctx, &sql.TxOptions{}, func(ctx context.Context, tx bun.Tx) error {
		if _, err := tx.ExecContext(ctx, traegerSchoolRolesUpSQL); err != nil {
			return fmt.Errorf("create traeger school roles: %w", err)
		}
		return nil
	})
}

func traegerSchoolRolesDown(ctx context.Context, db *bun.DB) error {
	return db.RunInTx(ctx, &sql.TxOptions{}, func(ctx context.Context, tx bun.Tx) error {
		if _, err := tx.ExecContext(ctx, traegerSchoolRolesDownSQL); err != nil {
			return fmt.Errorf("drop traeger school roles: %w", err)
		}
		return nil
	})
}
