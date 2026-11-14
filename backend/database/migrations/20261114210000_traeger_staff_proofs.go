package migrations

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/uptrace/bun"
)

const traegerStaffProofsVersion = "20261114210000"

func init() {
	MigrationRegistry.Register(&Migration{
		Version:     traegerStaffProofsVersion,
		Description: "Nachweise am Personalstamm des Trägers mit Nachweisarten, Ablaufwarnung und Zuordnung der Schul-Arten (#4707, ADR 0089 §7)",
		DependsOn: []string{
			traegerStaffRecordsVersion,     // the Personalstamm the proofs hang on (#4705)
			staffQualificationTypesVersion, // the school kinds a Träger kind takes over (#4808)
		},
	})
	Migrations.MustRegister(traegerStaffProofsUp, traegerStaffProofsDown)
}

// traegerStaffProofsUpSQL adds the Nachweise of ADR 0089 section 7 (#4707).
//
//   - workforce.staff_proof_types are the kinds of proof a Träger asks for:
//     the standard list (standard_key set) and its own kinds, with the
//     validity that suggests the expiry date, the reminder lead and whether
//     every person needs one. A kind is archived, never deleted.
//   - workforce.staff_proofs is one proof of one kind at one Personalstamm:
//     the day it was presented, for a certificate of conduct the day it was
//     issued and that it holds no relevant entry, and the expiry date. A
//     renewal replaces the row. Nothing else of a document is stored, and no
//     copy (§ 72a Abs. 5 SGB VIII). The reminder columns hold the expiry date
//     the reminder before and on the expiry day went out for.
//   - workforce.staff_proof_type_mappings maps a kind of a school
//     (users.staff_qualification_types, #4808) onto a kind of its Träger, once
//     per school kind (decision E4 of 13.11.2026). For an employment the
//     Träger keeps in a record, the school's own entry of a mapped kind then
//     no longer reminds; the Träger's proof does. The row names the school
//     and its kind by plain id, like the other Träger tables, so the school
//     erasure plan stays untouched.
//
// A school without a released Träger has no record, no link and no mapping:
// nothing of this changes what it sees or gets.
const traegerStaffProofsUpSQL = `
CREATE TABLE workforce.staff_proof_types (
	id BIGSERIAL PRIMARY KEY,
	organization_id BIGINT NOT NULL REFERENCES platform.organizations(id) ON DELETE CASCADE,
	standard_key VARCHAR(32),
	name VARCHAR(100) NOT NULL,
	validity_months INTEGER,
	reminder_lead_weeks INTEGER NOT NULL DEFAULT 8,
	mandatory BOOLEAN NOT NULL DEFAULT FALSE,
	sort_order INTEGER NOT NULL DEFAULT 0,
	archived_at TIMESTAMPTZ,
	created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
	updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
	CONSTRAINT uq_workforce_staff_proof_types_organization_id UNIQUE (organization_id, id),
	CONSTRAINT chk_workforce_staff_proof_types_name CHECK (btrim(name) <> ''),
	CONSTRAINT chk_workforce_staff_proof_types_standard_key
		CHECK (standard_key IS NULL OR standard_key IN ('police_certificate', 'measles_protection', 'prevention_training')),
	CONSTRAINT chk_workforce_staff_proof_types_validity CHECK (validity_months IS NULL OR validity_months BETWEEN 1 AND 240),
	CONSTRAINT chk_workforce_staff_proof_types_lead CHECK (reminder_lead_weeks BETWEEN 0 AND 52)
);
CREATE UNIQUE INDEX uq_workforce_staff_proof_types_standard ON workforce.staff_proof_types (organization_id, standard_key)
	WHERE standard_key IS NOT NULL;
CREATE UNIQUE INDEX uq_workforce_staff_proof_types_live_name ON workforce.staff_proof_types (organization_id, lower(btrim(name)))
	WHERE archived_at IS NULL;
COMMENT ON TABLE workforce.staff_proof_types IS
	'Nachweisarten des Trägers (#4707, ADR 0089 section 7): standard list and own kinds with validity, reminder lead and mandatory flag. Archived, never deleted.';

CREATE TABLE workforce.staff_proofs (
	id BIGSERIAL PRIMARY KEY,
	organization_id BIGINT NOT NULL,
	staff_record_id BIGINT NOT NULL,
	type_id BIGINT NOT NULL,
	presented_on DATE NOT NULL,
	issued_on DATE,
	no_relevant_entry BOOLEAN NOT NULL DEFAULT FALSE,
	expires_on DATE,
	lead_reminded_for DATE,
	expiry_reminded_for DATE,
	recorded_by_account_id BIGINT NOT NULL,
	created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
	updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
	CONSTRAINT fk_workforce_staff_proofs_record FOREIGN KEY (organization_id, staff_record_id)
		REFERENCES workforce.staff_records (organization_id, id) ON DELETE CASCADE,
	CONSTRAINT fk_workforce_staff_proofs_type FOREIGN KEY (organization_id, type_id)
		REFERENCES workforce.staff_proof_types (organization_id, id),
	CONSTRAINT uq_workforce_staff_proofs_record_type UNIQUE (staff_record_id, type_id),
	CONSTRAINT chk_workforce_staff_proofs_issued CHECK (issued_on IS NULL OR issued_on <= presented_on),
	CONSTRAINT chk_workforce_staff_proofs_expiry CHECK (expires_on IS NULL OR expires_on >= presented_on)
);
CREATE INDEX idx_workforce_staff_proofs_expiry ON workforce.staff_proofs (organization_id, expires_on) WHERE expires_on IS NOT NULL;
COMMENT ON TABLE workforce.staff_proofs IS
	'Nachweise am Personalstamm (#4707, ADR 0089 section 7): kind, day presented, expiry and for a certificate of conduct its issue day and the result „keine einschlägige Eintragung“; never a copy (§ 72a Abs. 5 SGB VIII).';

CREATE TABLE workforce.staff_proof_type_mappings (
	organization_id BIGINT NOT NULL,
	school_id BIGINT NOT NULL,
	school_type_id BIGINT NOT NULL,
	proof_type_id BIGINT NOT NULL,
	mapped_by_account_id BIGINT NOT NULL,
	mapped_at TIMESTAMPTZ NOT NULL DEFAULT now(),
	PRIMARY KEY (school_id, school_type_id),
	CONSTRAINT fk_workforce_staff_proof_type_mappings_type FOREIGN KEY (organization_id, proof_type_id)
		REFERENCES workforce.staff_proof_types (organization_id, id) ON DELETE CASCADE
);
CREATE INDEX idx_workforce_staff_proof_type_mappings_organization ON workforce.staff_proof_type_mappings (organization_id, school_id);
COMMENT ON TABLE workforce.staff_proof_type_mappings IS
	'Zuordnung einer Nachweisart der Schule zu einer Nachweisart des Trägers (#4707, Entscheidung E4): einmal je Schul-Art, mit einfachen IDs wie die anderen Träger-Tabellen.';

CREATE TRIGGER trg_workforce_staff_proof_types_updated_at BEFORE UPDATE ON workforce.staff_proof_types
	FOR EACH ROW EXECUTE FUNCTION update_modified_column();
CREATE TRIGGER trg_workforce_staff_proofs_updated_at BEFORE UPDATE ON workforce.staff_proofs
	FOR EACH ROW EXECUTE FUNCTION update_modified_column();

ALTER TABLE workforce.staff_proof_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE workforce.staff_proof_types FORCE ROW LEVEL SECURITY;
CREATE POLICY traeger_isolation_workforce_staff_proof_types ON workforce.staff_proof_types FOR ALL
	USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::bigint)
	WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::bigint);

ALTER TABLE workforce.staff_proofs ENABLE ROW LEVEL SECURITY;
ALTER TABLE workforce.staff_proofs FORCE ROW LEVEL SECURITY;
CREATE POLICY traeger_isolation_workforce_staff_proofs ON workforce.staff_proofs FOR ALL
	USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::bigint)
	WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::bigint);

ALTER TABLE workforce.staff_proof_type_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE workforce.staff_proof_type_mappings FORCE ROW LEVEL SECURITY;
CREATE POLICY traeger_isolation_workforce_staff_proof_type_mappings ON workforce.staff_proof_type_mappings FOR ALL
	USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::bigint)
	WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::bigint);

-- The status a school sees of the Träger's proofs (ADR 0089 section 7):
-- for each of its own employments the Träger keeps in a record, per live
-- kind that is mandatory or held, the kind's name, whether a proof exists
-- and until when it holds, and the school kinds mapped onto it. Nothing of
-- the proof itself (days presented, result) and nothing of another school
-- leaves. The school's role reads no Träger table, so the function runs as
-- its owner and filters on the school of the tenant transaction.
CREATE FUNCTION workforce.school_traeger_proof_status()
RETURNS TABLE (membership_id BIGINT, proof_type_id BIGINT, type_name VARCHAR, mandatory BOOLEAN, held BOOLEAN,
	expires_on DATE, reminder_lead_weeks INTEGER, school_type_ids BIGINT[])
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
	SELECT link.membership_id, kind.id, kind.name, kind.mandatory, proof.id IS NOT NULL, proof.expires_on,
		kind.reminder_lead_weeks,
		COALESCE((SELECT array_agg(mapping.school_type_id ORDER BY mapping.school_type_id)
			FROM workforce.staff_proof_type_mappings AS mapping
			WHERE mapping.organization_id = kind.organization_id AND mapping.proof_type_id = kind.id
			  AND mapping.school_id = link.school_id), ARRAY[]::BIGINT[])
	FROM workforce.staff_record_links AS link
	JOIN workforce.staff_proof_types AS kind ON kind.organization_id = link.organization_id AND kind.archived_at IS NULL
	LEFT JOIN workforce.staff_proofs AS proof
		ON proof.organization_id = link.organization_id AND proof.staff_record_id = link.staff_record_id AND proof.type_id = kind.id
	WHERE link.school_id = NULLIF(current_setting('app.current_tenant_id', true), '')::bigint
	  AND (kind.mandatory OR proof.id IS NOT NULL)
	ORDER BY link.membership_id, kind.sort_order, kind.id
$$;
REVOKE ALL ON FUNCTION workforce.school_traeger_proof_status() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION workforce.school_traeger_proof_status() TO phoenix_tenant;

REVOKE ALL ON workforce.staff_proof_types, workforce.staff_proofs, workforce.staff_proof_type_mappings FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON workforce.staff_proof_types TO phoenix_tenant;
GRANT SELECT, INSERT, UPDATE, DELETE ON workforce.staff_proofs, workforce.staff_proof_type_mappings TO phoenix_tenant;
GRANT USAGE ON SEQUENCE workforce.staff_proof_types_id_seq, workforce.staff_proofs_id_seq TO phoenix_tenant;
GRANT ALL ON workforce.staff_proof_types, workforce.staff_proofs, workforce.staff_proof_type_mappings TO phoenix_admin;
GRANT USAGE ON SEQUENCE workforce.staff_proof_types_id_seq, workforce.staff_proofs_id_seq TO phoenix_admin;
`

const traegerStaffProofsDownSQL = `
DROP FUNCTION IF EXISTS workforce.school_traeger_proof_status();
DROP TABLE IF EXISTS workforce.staff_proof_type_mappings;
DROP TABLE IF EXISTS workforce.staff_proofs;
DROP TABLE IF EXISTS workforce.staff_proof_types;
`

func traegerStaffProofsUp(ctx context.Context, db *bun.DB) error {
	return db.RunInTx(ctx, &sql.TxOptions{}, func(ctx context.Context, tx bun.Tx) error {
		if _, err := tx.ExecContext(ctx, traegerStaffProofsUpSQL); err != nil {
			return fmt.Errorf("create traeger staff proofs: %w", err)
		}
		return nil
	})
}

func traegerStaffProofsDown(ctx context.Context, db *bun.DB) error {
	return db.RunInTx(ctx, &sql.TxOptions{}, func(ctx context.Context, tx bun.Tx) error {
		if _, err := tx.ExecContext(ctx, traegerStaffProofsDownSQL); err != nil {
			return fmt.Errorf("drop traeger staff proofs: %w", err)
		}
		return nil
	})
}
