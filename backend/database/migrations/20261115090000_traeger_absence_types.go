package migrations

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/uptrace/bun"
)

const traegerAbsenceTypesVersion = "20261115090000"

func init() {
	MigrationRegistry.Register(&Migration{
		Version:     traegerAbsenceTypesVersion,
		Description: "Abwesenheitsarten und Kontingente des Trägers mit Abweichung je Schule (#4710, ADR 0089 §10)",
		DependsOn: []string{
			traegerStaffRecordsVersion, // the Personalstamm whose Einsatzorte share one Kontingent
			payrollWageTypesVersion,    // the last change to active.staff_absence_types before this one
		},
	})
	Migrations.MustRegister(traegerAbsenceTypesUp, traegerAbsenceTypesDown)
}

// traegerAbsenceTypesUpSQL adds the Abwesenheitsarten and Kontingente of a
// Träger (#4710, ADR 0089 section 10 with its addendum of 14.11.2026).
//
//   - workforce.absence_types is an Abwesenheitsart of the Träger: a name,
//     an optional Kontingent with a standard in days per year, the day its
//     rest expires and whether caregivers may request it. Workforce writes
//     every type into each school of the Träger as a row of
//     active.staff_absence_types that names it (traeger_absence_type_id).
//   - workforce.absence_allowances is the Kontingent the Personalverwaltung
//     sets for one person (Personalakte), type and year instead of the
//     standard; workforce.absence_allowance_changes is its trail.
//   - active.staff_absence_types gets the link to the Träger's type, whether
//     staff may request the type, and the school's deviation for its own
//     Einsätze: not offered here, or at most N days per person and year here.
//   - workforce.absence_pool_claims and workforce.absence_pool_uses read the
//     one Kontingent of a Personalakte over all its schools for the check of
//     a booking in a school's tenant transaction. They answer only a school
//     that is an Einsatzort of the record, or the record's own Träger, name
//     no other school in a tenant transaction and lock the Kontingent until
//     the transaction ends, so two schools cannot book the same rest. They
//     run as their owner because the request role sees neither the other
//     schools' bookings nor the Träger's claims, and they write nothing.
const traegerAbsenceTypesUpSQL = `
CREATE TABLE workforce.absence_types (
	id BIGSERIAL PRIMARY KEY,
	organization_id BIGINT NOT NULL REFERENCES platform.organizations(id) ON DELETE CASCADE,
	name VARCHAR(100) NOT NULL,
	allowance_enabled BOOLEAN NOT NULL DEFAULT false,
	standard_days NUMERIC(5,1) NOT NULL DEFAULT 0,
	carryover_until CHAR(5),
	requestable BOOLEAN NOT NULL DEFAULT false,
	is_active BOOLEAN NOT NULL DEFAULT true,
	created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
	updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
	CONSTRAINT uq_workforce_absence_types_organization_id UNIQUE (organization_id, id),
	CONSTRAINT chk_workforce_absence_types_name CHECK (btrim(name) <> ''),
	CONSTRAINT chk_workforce_absence_types_standard_days CHECK (
		standard_days >= 0 AND standard_days <= 366 AND standard_days * 2 = trunc(standard_days * 2)),
	CONSTRAINT chk_workforce_absence_types_carryover_until CHECK (
		carryover_until ~ '^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$')
);
CREATE UNIQUE INDEX uq_workforce_absence_types_name ON workforce.absence_types (organization_id, lower(name));
COMMENT ON TABLE workforce.absence_types IS
	'Abwesenheitsart of a Träger (#4710, ADR 0089 section 10): mirrored into every school of the Träger as a row of active.staff_absence_types.';

CREATE TABLE workforce.absence_allowances (
	organization_id BIGINT NOT NULL,
	staff_record_id BIGINT NOT NULL,
	absence_type_id BIGINT NOT NULL,
	year INT NOT NULL,
	entitled_days NUMERIC(5,1) NOT NULL,
	updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
	PRIMARY KEY (organization_id, staff_record_id, absence_type_id, year),
	CONSTRAINT fk_workforce_absence_allowances_record FOREIGN KEY (organization_id, staff_record_id)
		REFERENCES workforce.staff_records (organization_id, id) ON DELETE CASCADE,
	CONSTRAINT fk_workforce_absence_allowances_type FOREIGN KEY (organization_id, absence_type_id)
		REFERENCES workforce.absence_types (organization_id, id) ON DELETE CASCADE,
	CONSTRAINT chk_workforce_absence_allowances_year CHECK (year BETWEEN 2000 AND 2100),
	CONSTRAINT chk_workforce_absence_allowances_days CHECK (
		entitled_days >= 0 AND entitled_days <= 366 AND entitled_days * 2 = trunc(entitled_days * 2))
);
COMMENT ON TABLE workforce.absence_allowances IS
	'Kontingent of one Personalakte for one Abwesenheitsart of the Träger and year (#4710): replaces the type''s standard for this person, over all schools.';

CREATE TABLE workforce.absence_allowance_changes (
	id BIGSERIAL PRIMARY KEY,
	organization_id BIGINT NOT NULL,
	staff_record_id BIGINT NOT NULL,
	absence_type_id BIGINT NOT NULL,
	year INT NOT NULL,
	old_entitled_days NUMERIC(5,1),
	new_entitled_days NUMERIC(5,1) NOT NULL,
	reason TEXT NOT NULL,
	account_id BIGINT NOT NULL,
	changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
	CONSTRAINT fk_workforce_absence_allowance_changes_record FOREIGN KEY (organization_id, staff_record_id)
		REFERENCES workforce.staff_records (organization_id, id) ON DELETE CASCADE,
	CONSTRAINT fk_workforce_absence_allowance_changes_type FOREIGN KEY (organization_id, absence_type_id)
		REFERENCES workforce.absence_types (organization_id, id) ON DELETE CASCADE,
	CONSTRAINT chk_workforce_absence_allowance_changes_reason CHECK (btrim(reason) <> '')
);
CREATE INDEX idx_workforce_absence_allowance_changes_record
	ON workforce.absence_allowance_changes (organization_id, staff_record_id, changed_at DESC, id DESC);
COMMENT ON TABLE workforce.absence_allowance_changes IS
	'Trail of the Kontingente of a Personalakte (#4710): old and new days with the reason the Personalverwaltung gave.';

CREATE TRIGGER trg_workforce_absence_types_updated_at BEFORE UPDATE ON workforce.absence_types
	FOR EACH ROW EXECUTE FUNCTION update_modified_column();

ALTER TABLE workforce.absence_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE workforce.absence_types FORCE ROW LEVEL SECURITY;
CREATE POLICY traeger_isolation_workforce_absence_types ON workforce.absence_types FOR ALL
	USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::bigint)
	WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::bigint);

ALTER TABLE workforce.absence_allowances ENABLE ROW LEVEL SECURITY;
ALTER TABLE workforce.absence_allowances FORCE ROW LEVEL SECURITY;
CREATE POLICY traeger_isolation_workforce_absence_allowances ON workforce.absence_allowances FOR ALL
	USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::bigint)
	WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::bigint);

ALTER TABLE workforce.absence_allowance_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE workforce.absence_allowance_changes FORCE ROW LEVEL SECURITY;
CREATE POLICY traeger_isolation_workforce_absence_allowance_changes ON workforce.absence_allowance_changes FOR ALL
	USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::bigint)
	WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::bigint);

REVOKE ALL ON workforce.absence_types, workforce.absence_allowances, workforce.absence_allowance_changes FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON workforce.absence_types TO phoenix_tenant;
GRANT SELECT, INSERT, UPDATE, DELETE ON workforce.absence_allowances TO phoenix_tenant;
-- The trail is append-only for the request role.
GRANT SELECT, INSERT ON workforce.absence_allowance_changes TO phoenix_tenant;
GRANT USAGE ON SEQUENCE workforce.absence_types_id_seq, workforce.absence_allowance_changes_id_seq TO phoenix_tenant;
GRANT ALL ON workforce.absence_types, workforce.absence_allowances, workforce.absence_allowance_changes TO phoenix_admin;
GRANT USAGE ON SEQUENCE workforce.absence_types_id_seq, workforce.absence_allowance_changes_id_seq TO phoenix_admin;

ALTER TABLE active.staff_absence_types
	ADD COLUMN traeger_absence_type_id BIGINT,
	ADD COLUMN requestable BOOLEAN NOT NULL DEFAULT false,
	ADD COLUMN offered BOOLEAN NOT NULL DEFAULT true,
	ADD COLUMN school_limit_days NUMERIC(5,1),
	ADD CONSTRAINT chk_staff_absence_types_school_limit_days CHECK (
		school_limit_days >= 0 AND school_limit_days <= 366 AND school_limit_days * 2 = trunc(school_limit_days * 2)),
	-- A school deviates only from a type of its Träger; its own types it
	-- simply changes or retires.
	ADD CONSTRAINT chk_staff_absence_types_deviation_needs_traeger CHECK (
		traeger_absence_type_id IS NOT NULL OR (offered AND school_limit_days IS NULL));
CREATE UNIQUE INDEX uq_staff_absence_types_traeger_type
	ON active.staff_absence_types (tenant_id, traeger_absence_type_id) WHERE traeger_absence_type_id IS NOT NULL;
COMMENT ON COLUMN active.staff_absence_types.traeger_absence_type_id IS
	'The Abwesenheitsart of the Träger this row carries at the school (#4710); by plain id like the other Träger references.';
COMMENT ON COLUMN active.staff_absence_types.offered IS
	'Deviation of the school (#4710): false when the school does not offer the Träger''s type for its Einsätze.';
COMMENT ON COLUMN active.staff_absence_types.school_limit_days IS
	'Deviation of the school (#4710): at most this many days per person and year at this school, within the Träger''s Kontingent.';

-- workforce.absence_pool_access answers whether the caller may read the
-- Kontingent of a record: its own Träger in the Träger transaction, or a
-- school that is an Einsatzort of the record in its tenant transaction.
CREATE FUNCTION workforce.absence_pool_access(p_staff_record_id BIGINT) RETURNS BIGINT
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
	v_org BIGINT := NULLIF(current_setting('app.current_org_id', true), '')::bigint;
	v_school BIGINT := NULLIF(current_setting('app.current_tenant_id', true), '')::bigint;
	v_record_org BIGINT;
BEGIN
	SELECT organization_id INTO v_record_org FROM workforce.staff_records WHERE id = p_staff_record_id;
	IF v_record_org IS NULL THEN
		RETURN NULL;
	END IF;
	IF v_school IS NOT NULL THEN
		IF EXISTS (SELECT FROM workforce.staff_record_links
			WHERE organization_id = v_record_org AND staff_record_id = p_staff_record_id AND school_id = v_school) THEN
			RETURN v_record_org;
		END IF;
		RETURN NULL;
	END IF;
	IF v_org = v_record_org THEN
		RETURN v_record_org;
	END IF;
	RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION workforce.absence_pool_access(BIGINT) FROM PUBLIC;

-- workforce.absence_pool_claims returns one row per requested type of the
-- Träger (year NULL: standard, rest rule, the year the type was created)
-- and one row per year the Personalverwaltung set for this person. With
-- p_lock it first holds the Kontingente until the transaction ends, in the
-- order of the type ids, so claims and bookings read afterwards stay valid
-- until the booking commits.
CREATE FUNCTION workforce.absence_pool_claims(p_staff_record_id BIGINT, p_traeger_type_ids BIGINT[], p_lock BOOLEAN)
RETURNS TABLE (
	traeger_absence_type_id BIGINT, allowance_enabled BOOLEAN, standard_days NUMERIC, carryover_until TEXT,
	first_year INT, year INT, entitled_days NUMERIC)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
	v_org BIGINT := workforce.absence_pool_access(p_staff_record_id);
BEGIN
	IF v_org IS NULL THEN
		RETURN;
	END IF;
	IF p_lock THEN
		PERFORM pg_advisory_xact_lock(hashtextextended('workforce.absence_pool:' || p_staff_record_id || ':' || ordered.type_id, 0))
		FROM (SELECT DISTINCT unnest(p_traeger_type_ids) AS type_id ORDER BY 1) AS ordered;
	END IF;
	RETURN QUERY
		SELECT t.id, t.allowance_enabled, t.standard_days, t.carryover_until::text,
			extract(year FROM t.created_at AT TIME ZONE 'Europe/Berlin')::int, NULL::int, NULL::numeric
		FROM workforce.absence_types t
		WHERE t.organization_id = v_org AND t.id = ANY(p_traeger_type_ids)
		UNION ALL
		SELECT a.absence_type_id, NULL, NULL, NULL, NULL, a.year, a.entitled_days
		FROM workforce.absence_allowances a
		WHERE a.organization_id = v_org AND a.staff_record_id = p_staff_record_id AND a.absence_type_id = ANY(p_traeger_type_ids);
END;
$$;
REVOKE ALL ON FUNCTION workforce.absence_pool_claims(BIGINT, BIGINT[], BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION workforce.absence_pool_claims(BIGINT, BIGINT[], BOOLEAN) TO phoenix_tenant;

-- workforce.absence_pool_uses returns the bookings of the requested types
-- at every Einsatzort of the record that overlap [p_from, p_to] and still
-- count. In a tenant transaction school_id is set only for that school.
CREATE FUNCTION workforce.absence_pool_uses(p_staff_record_id BIGINT, p_traeger_type_ids BIGINT[], p_from DATE, p_to DATE)
RETURNS TABLE (
	traeger_absence_type_id BIGINT, absence_id BIGINT, school_id BIGINT, date_start DATE, date_end DATE,
	half_day BOOLEAN, start_half_day BOOLEAN, end_half_day BOOLEAN, status TEXT, created_at TIMESTAMPTZ)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
	v_org BIGINT := workforce.absence_pool_access(p_staff_record_id);
	v_school BIGINT := NULLIF(current_setting('app.current_tenant_id', true), '')::bigint;
BEGIN
	IF v_org IS NULL THEN
		RETURN;
	END IF;
	RETURN QUERY
		SELECT st.traeger_absence_type_id, a.id,
			CASE WHEN v_school IS NULL OR l.school_id = v_school THEN l.school_id END,
			a.date_start, a.date_end, a.half_day, a.start_half_day, a.end_half_day, a.status::text, a.created_at
		FROM workforce.staff_record_links l
		JOIN active.staff_absences a ON a.tenant_id = l.school_id AND a.staff_id = l.membership_id
		JOIN active.staff_absence_types st ON st.tenant_id = a.tenant_id AND st.id = a.absence_type_id
		JOIN workforce.absence_types t ON t.organization_id = v_org AND t.id = st.traeger_absence_type_id
		WHERE l.organization_id = v_org AND l.staff_record_id = p_staff_record_id
		  AND st.traeger_absence_type_id = ANY(p_traeger_type_ids)
		  AND a.status IN ('reported', 'approved', 'requested', 'question')
		  AND a.date_end >= p_from AND a.date_start <= p_to;
END;
$$;
REVOKE ALL ON FUNCTION workforce.absence_pool_uses(BIGINT, BIGINT[], DATE, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION workforce.absence_pool_uses(BIGINT, BIGINT[], DATE, DATE) TO phoenix_tenant;
`

const traegerAbsenceTypesDownSQL = `
DROP FUNCTION IF EXISTS workforce.absence_pool_uses(BIGINT, BIGINT[], DATE, DATE);
DROP FUNCTION IF EXISTS workforce.absence_pool_claims(BIGINT, BIGINT[], BOOLEAN);
DROP FUNCTION IF EXISTS workforce.absence_pool_access(BIGINT);
DROP INDEX IF EXISTS active.uq_staff_absence_types_traeger_type;
ALTER TABLE active.staff_absence_types
	DROP CONSTRAINT IF EXISTS chk_staff_absence_types_deviation_needs_traeger,
	DROP CONSTRAINT IF EXISTS chk_staff_absence_types_school_limit_days,
	DROP COLUMN IF EXISTS school_limit_days,
	DROP COLUMN IF EXISTS offered,
	DROP COLUMN IF EXISTS requestable,
	DROP COLUMN IF EXISTS traeger_absence_type_id;
DROP TABLE IF EXISTS workforce.absence_allowance_changes;
DROP TABLE IF EXISTS workforce.absence_allowances;
DROP TABLE IF EXISTS workforce.absence_types;
`

func traegerAbsenceTypesUp(ctx context.Context, db *bun.DB) error {
	return db.RunInTx(ctx, &sql.TxOptions{}, func(ctx context.Context, tx bun.Tx) error {
		if _, err := tx.ExecContext(ctx, traegerAbsenceTypesUpSQL); err != nil {
			return fmt.Errorf("create traeger absence types: %w", err)
		}
		return nil
	})
}

func traegerAbsenceTypesDown(ctx context.Context, db *bun.DB) error {
	return db.RunInTx(ctx, &sql.TxOptions{}, func(ctx context.Context, tx bun.Tx) error {
		if _, err := tx.ExecContext(ctx, traegerAbsenceTypesDownSQL); err != nil {
			return fmt.Errorf("drop traeger absence types: %w", err)
		}
		return nil
	})
}
