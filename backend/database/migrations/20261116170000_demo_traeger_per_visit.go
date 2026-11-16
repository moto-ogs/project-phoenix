package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

const demoTraegerPerVisitVersion = "20261116170000"

func init() {
	MigrationRegistry.Register(&Migration{
		Version:     demoTraegerPerVisitVersion,
		Description: "Öffentliche Demo: eigener Demo-Träger je Besuch, mit Stilllegung und Löschung (#6193, ADR 0271)",
		DependsOn: []string{
			demoSchoolDatabaseErasureVersion,     // the school erasure the Träger erasure waits for
			demoRetirementRevokesSessionsVersion, // the session revocation the Träger's version follows
			demoSchoolFileErasuresVersion,        // the school origins the Träger origins mirror
		},
	})
	Migrations.MustRegister(demoTraegerPerVisitUp, demoTraegerPerVisitDown)
}

// demoTraegerPerVisitUpSQL gives every demo order a Träger of its own (#6193,
// ADR 0271).
//
//   - platform.demo_school_states.traeger_id names the order's own Demo-Träger.
//     The demo control plane writes it once the seed created the Träger; the
//     serving role reads it to sign the visitor in to the Träger-Portal. It
//     has no foreign key: the order row is erased long before its Träger.
//   - platform.demo_traeger_origins proves that a Träger is a Demo-Träger, as
//     platform.demo_school_origins does for a school (ADR 0148): the visitor
//     erasure deletes the order row, so the order cannot be the proof 90 days
//     later. A trigger records it; no caller can add a row. The Träger erasure
//     writes its time and row counts onto it.
//   - platform.retired_demo_traeger_due and
//     platform.retired_demo_traegers_due_for_erasure find the Demo-Träger
//     whose last school is erased: a demo origin, no school, no order. The
//     erasure itself (platform.erase_retired_demo_traeger) is repeatable.
//   - platform.retire_failed_demo_traeger does the same for an order whose
//     final attempt failed: a deferred seed can fail after visitors entered
//     the school (RequeueDeferred), so its Träger goes out of service and
//     its sessions end. Only the demo process may call it.
//   - auth.revoke_organization_sessions ends every session of a Träger: the
//     Träger-Portal's, and every session at its schools (#6305 for one
//     school). Accounts first, then the schools, the lock order of a sign-in.
//
// The retirement (platform.retire_expired_demo_schools) and the Träger
// erasure (platform.erase_retired_demo_traeger) have repeatable definitions
// (ADR 0223).
const demoTraegerPerVisitUpSQL = `
	ALTER TABLE platform.demo_school_states ADD COLUMN traeger_id BIGINT CHECK (traeger_id > 0);
	COMMENT ON COLUMN platform.demo_school_states.traeger_id IS
		'The order''s own Demo-Träger (#6193, ADR 0271): every school of it belongs to this order. NULL for orders seeded under the shared Demo-Träger.';
	GRANT SELECT (traeger_id) ON platform.demo_school_states TO phoenix_admin;
	-- The final failure hides the schools of the order's own Träger as well.
	GRANT SELECT (organization_id) ON platform.schools TO phoenix_demo;

	CREATE TABLE platform.demo_traeger_origins (
		organization_id BIGINT PRIMARY KEY,
		recorded_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
		erased_at TIMESTAMPTZ,
		row_counts JSONB,
		CONSTRAINT demo_traeger_origins_erasure_evidence CHECK (
			(erased_at IS NULL AND row_counts IS NULL)
			OR (erased_at IS NOT NULL AND jsonb_typeof(row_counts) = 'object'))
	);
	COMMENT ON TABLE platform.demo_traeger_origins IS
		'Demo origin of a Träger (#6193, ADR 0271): a demo order created this Träger for itself. Recorded by trigger, never by a caller; only these Träger are erased with their schools. Counts only, no names.';
	REVOKE ALL ON platform.demo_traeger_origins FROM PUBLIC, phoenix_auth, phoenix_tenant, phoenix_admin;
	GRANT SELECT ON platform.demo_traeger_origins TO phoenix_demo;

	CREATE FUNCTION platform.record_demo_traeger_origin()
	RETURNS TRIGGER
	LANGUAGE plpgsql
	SECURITY DEFINER
	SET search_path = pg_catalog
	AS $$
	BEGIN
		IF NEW.traeger_id IS NOT NULL THEN
			INSERT INTO platform.demo_traeger_origins (organization_id) VALUES (NEW.traeger_id)
			ON CONFLICT (organization_id) DO NOTHING;
		END IF;
		RETURN NULL;
	END;
	$$;
	REVOKE ALL ON FUNCTION platform.record_demo_traeger_origin() FROM PUBLIC;
	CREATE TRIGGER demo_school_states_record_traeger_origin
		AFTER INSERT OR UPDATE OF traeger_id ON platform.demo_school_states
		FOR EACH ROW EXECUTE FUNCTION platform.record_demo_traeger_origin();

	CREATE FUNCTION auth.revoke_organization_sessions(organization_id BIGINT)
	RETURNS SETOF auth.tokens
	LANGUAGE plpgsql
	VOLATILE
	SET search_path = pg_catalog
	AS $$
	BEGIN
		PERFORM 1 FROM auth.accounts AS account
		WHERE account.id IN (
			SELECT token.account_id FROM auth.tokens AS token
			WHERE token.organization_id = revoke_organization_sessions.organization_id
				OR token.tenant_id IN (SELECT school.id FROM platform.schools AS school
					WHERE school.organization_id = revoke_organization_sessions.organization_id))
		ORDER BY account.id
		FOR NO KEY UPDATE;
		PERFORM 1 FROM platform.schools AS school
		WHERE school.organization_id = revoke_organization_sessions.organization_id
		ORDER BY school.id
		FOR NO KEY UPDATE;
		RETURN QUERY DELETE FROM auth.tokens AS token
		WHERE token.organization_id = revoke_organization_sessions.organization_id
			OR token.tenant_id IN (SELECT school.id FROM platform.schools AS school
				WHERE school.organization_id = revoke_organization_sessions.organization_id)
		RETURNING token.*;
	END;
	$$;
	REVOKE ALL ON FUNCTION auth.revoke_organization_sessions(BIGINT) FROM PUBLIC;
	GRANT EXECUTE ON FUNCTION auth.revoke_organization_sessions(BIGINT) TO phoenix_admin;
	COMMENT ON FUNCTION auth.revoke_organization_sessions(BIGINT) IS
		'Identity & Access (#6193): ends every session of the Träger and of its schools, accounts locked first, then the schools until commit. Called before a Demo-Träger''s schools are hidden.';

	CREATE FUNCTION platform.retired_demo_traeger_due(p_organization_id BIGINT)
	RETURNS BOOLEAN LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = pg_catalog
	AS $body$
		SELECT EXISTS (
			SELECT 1
			FROM platform.organizations AS organization
			JOIN platform.demo_traeger_origins AS origin ON origin.organization_id = organization.id
			WHERE organization.id = p_organization_id
				AND origin.erased_at IS NULL
				AND NOT EXISTS (SELECT 1 FROM platform.schools AS school WHERE school.organization_id = organization.id)
				AND NOT EXISTS (SELECT 1 FROM platform.demo_school_states AS state WHERE state.traeger_id = organization.id))
	$body$;
	REVOKE ALL ON FUNCTION platform.retired_demo_traeger_due(BIGINT) FROM PUBLIC;

	CREATE FUNCTION platform.retired_demo_traegers_due_for_erasure(p_limit INTEGER)
	RETURNS SETOF BIGINT LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog
	AS $body$
		-- Random order: a Träger that keeps failing never holds up the others.
		SELECT origin.organization_id
		FROM platform.demo_traeger_origins AS origin
		WHERE origin.erased_at IS NULL AND platform.retired_demo_traeger_due(origin.organization_id)
		ORDER BY random()
		LIMIT LEAST(GREATEST(p_limit, 0), 50)
	$body$;

	CREATE FUNCTION platform.retire_failed_demo_traeger(p_name TEXT)
	RETURNS VOID LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog
	AS $body$
	DECLARE
		v_traeger BIGINT;
	BEGIN
		SELECT state.traeger_id INTO v_traeger FROM platform.demo_school_states AS state
		WHERE state.name = p_name AND state.status = 'failed' AND state.traeger_id IS NOT NULL;
		IF v_traeger IS NULL THEN
			RETURN;
		END IF;
		PERFORM auth.revoke_organization_sessions(v_traeger);
		UPDATE platform.organizations SET active = false WHERE id = v_traeger AND active;
	END $body$;
	REVOKE ALL ON FUNCTION platform.retire_failed_demo_traeger(TEXT) FROM PUBLIC, phoenix_auth, phoenix_tenant, phoenix_admin;
	GRANT EXECUTE ON FUNCTION platform.retire_failed_demo_traeger(TEXT) TO phoenix_demo;
	COMMENT ON FUNCTION platform.retire_failed_demo_traeger(TEXT) IS
		'Demo process only (#6193, ADR 0271): after the final failure of an order its own Träger goes out of service and every session of it and its schools ends. A deferred seed can fail after visitors entered.';

	REVOKE ALL ON FUNCTION platform.retired_demo_traegers_due_for_erasure(INTEGER)
		FROM PUBLIC, phoenix_auth, phoenix_tenant, phoenix_admin, phoenix_school_erasure;
	GRANT EXECUTE ON FUNCTION platform.retired_demo_traegers_due_for_erasure(INTEGER) TO phoenix_demo;
`

func demoTraegerPerVisitUp(ctx context.Context, db *bun.DB) error {
	return db.RunInTx(ctx, nil, func(ctx context.Context, tx bun.Tx) error {
		if _, err := tx.ExecContext(ctx, demoTraegerPerVisitUpSQL); err != nil {
			return fmt.Errorf("give every demo order a Träger of its own: %w", err)
		}
		return nil
	})
}

// demoTraegerPerVisitDown refuses once a Demo-Träger is erased: the rows are
// gone, and dropping the origins would discard the only evidence. It also
// drops the Träger erasure the repeatable definition installs on top. The
// retirement keeps its one definition (ADR 0223) and finds what it reads
// again with the next run.
func demoTraegerPerVisitDown(ctx context.Context, db *bun.DB) error {
	return db.RunInTx(ctx, nil, func(ctx context.Context, tx bun.Tx) error {
		var erased int
		if err := tx.NewRaw(`SELECT count(*) FROM platform.demo_traeger_origins WHERE erased_at IS NOT NULL`).Scan(ctx, &erased); err != nil {
			return err
		}
		if erased != 0 {
			return fmt.Errorf("demo Träger rollback would discard erasure evidence; use a forward migration")
		}
		if _, err := tx.ExecContext(ctx, `
			DROP FUNCTION IF EXISTS platform.erase_retired_demo_traeger(BIGINT);
			DROP FUNCTION IF EXISTS platform.retired_demo_traegers_due_for_erasure(INTEGER);
			DROP FUNCTION IF EXISTS platform.retired_demo_traeger_due(BIGINT);
			DROP FUNCTION IF EXISTS platform.retire_failed_demo_traeger(TEXT);
			REVOKE SELECT (organization_id) ON platform.schools FROM phoenix_demo;
			DROP FUNCTION IF EXISTS auth.revoke_organization_sessions(BIGINT);
			DROP TRIGGER IF EXISTS demo_school_states_record_traeger_origin ON platform.demo_school_states;
			DROP FUNCTION IF EXISTS platform.record_demo_traeger_origin();
			DROP TABLE IF EXISTS platform.demo_traeger_origins;
			ALTER TABLE platform.demo_school_states DROP COLUMN IF EXISTS traeger_id`); err != nil {
			return fmt.Errorf("drop the Träger of demo orders: %w", err)
		}
		return nil
	})
}
