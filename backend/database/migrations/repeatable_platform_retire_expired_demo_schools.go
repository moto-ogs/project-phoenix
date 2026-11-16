package migrations

import (
	"context"

	"github.com/uptrace/bun"
)

func init() {
	RegisterRepeatable("platform.retire_expired_demo_schools", func(ctx context.Context, tx bun.Tx) error {
		_, err := tx.ExecContext(ctx, repeatablePlatformRetireExpiredDemoSchoolsSQL)
		return err
	})
}

// repeatablePlatformRetireExpiredDemoSchoolsSQL is the current definition of
// platform.retire_expired_demo_schools(TEXT[]) (ADR 0223). Change the
// function here; numbered migrations no longer define it.
//
// Since #6193 (ADR 0271) an order may have a Träger of its own
// (platform.demo_school_states.traeger_id). Its retirement then hides every
// school of that Träger, the neighbour schools with the visitor's school, and
// ends the sessions of the Träger and of all its schools first
// (auth.revoke_organization_sessions), in the lock order of a sign-in, and
// deactivates the Träger, which every Träger session requires. An order
// under the shared Demo-Träger hides its own school as before.
// CREATE OR REPLACE keeps its grants (phoenix_demo only).
const repeatablePlatformRetireExpiredDemoSchoolsSQL = `
		CREATE OR REPLACE FUNCTION platform.retire_expired_demo_schools(names TEXT[])
		RETURNS TABLE(hidden INTEGER, erased INTEGER)
		LANGUAGE plpgsql
		VOLATILE
		SECURITY DEFINER
		SET search_path = pg_catalog
		SET lock_timeout = '100ms'
		AS $$
		DECLARE
			target_name TEXT;
			targets TEXT[];
			hidden_count INTEGER := 0;
			changed INTEGER;
			tried INTEGER := 0;
			hidden_school BIGINT;
			hidden_traeger BIGINT;
		BEGIN
			hidden := 0;
			erased := 0;
			IF NOT pg_try_advisory_xact_lock(hashtextextended('platform.demo_school_states:visitor-erasure', 0)) THEN
				RAISE LOG 'demo school retirement skipped: another run holds the run lock';
				RETURN NEXT;
				RETURN;
			END IF;
			BEGIN
				-- Orders deferred less often come first, so orders that stay
				-- locked never starve the others of the budget.
				SELECT COALESCE(array_agg(target.name ORDER BY COALESCE(ordered.erasure_deferrals, 0), target.name), '{}'::TEXT[]) INTO targets
				FROM (
					SELECT name FROM unnest(COALESCE(names, '{}'::TEXT[])) AS named(name)
					UNION
					SELECT state.name
					FROM platform.demo_school_states AS state
					JOIN platform.schools AS school ON school.id = state.tenant_id
					WHERE state.status = 'ready'
						AND state.first_name <> ''
						AND school.deleted_at IS NULL
						AND NOT EXISTS (SELECT 1 FROM auth.demo_accesses AS access WHERE access.school_slug = state.name)
				) AS target
				LEFT JOIN platform.demo_school_states AS ordered ON ordered.name = target.name;
			EXCEPTION WHEN lock_not_available OR deadlock_detected THEN
				RAISE LOG 'demo school retirement skipped this run (SQLSTATE %): a table it reads is locked', SQLSTATE;
				RETURN NEXT;
				RETURN;
			END;
			FOREACH target_name IN ARRAY targets
			LOOP
				-- The retirement has a budget of its own: it starts no order after
				-- 200 ms, so the erasure keeps its turn. Each lock wait ends after
				-- 100 ms; an order already started is finished, so the run time is
				-- bounded, not cut off. The rest is found again.
				IF tried >= 50 OR clock_timestamp() - statement_timestamp() > INTERVAL '200 milliseconds' THEN
					RAISE LOG 'demo school retirement ends this run at its budget: % schools hidden, the rest stays open', hidden_count;
					EXIT;
				END IF;
				tried := tried + 1;
				BEGIN
					-- Only an order still open to visitors or still waiting is
					-- retired here. A hidden or failed order is the erasure's, which
					-- takes the same locks: one order, one deferral a run.
					PERFORM 1 FROM platform.demo_school_states AS state
					LEFT JOIN platform.schools AS school ON school.id = state.tenant_id
					WHERE state.name = target_name
						AND (state.status = 'ready' OR (state.status = 'preparing' AND state.claimed_at IS NULL))
						AND (school.id IS NULL OR school.deleted_at IS NULL);
					IF NOT FOUND THEN
						CONTINUE;
					END IF;
					PERFORM pg_advisory_xact_lock(hashtextextended('demo school seed:' || target_name, 3461));
					PERFORM pg_advisory_xact_lock(hashtextextended('platform.demo_school_states:' || target_name, 0));
					IF EXISTS (SELECT 1 FROM auth.demo_accesses AS access WHERE access.school_slug = target_name) THEN
						CONTINUE;
					END IF;
					-- The school's sessions end with it, in this subtransaction
					-- (#6305): every request checks the family an access token
					-- names, not the school. They end first, in the lock order of
					-- a sign-in; a session lock in use defers the order, its
					-- hiding included.
					SELECT school.id INTO hidden_school
						FROM platform.demo_school_states AS state
						JOIN platform.schools AS school ON school.id = state.tenant_id
						WHERE state.name = target_name
							AND (state.status = 'ready' OR (state.status = 'preparing' AND state.claimed_at IS NULL))
							AND school.deleted_at IS NULL;
					-- An order with a Träger of its own (ADR 0271) owns every school of
					-- it: the neighbour schools go with the visitor's school, and so
					-- do the sessions of its Träger-Portal and of its Absprünge.
					SELECT state.traeger_id INTO hidden_traeger
						FROM platform.demo_school_states AS state
						WHERE state.name = target_name
							AND (state.status = 'ready' OR (state.status = 'preparing' AND state.claimed_at IS NULL));
					IF hidden_traeger IS NOT NULL THEN
						PERFORM auth.revoke_organization_sessions(hidden_traeger);
					ELSIF hidden_school IS NOT NULL THEN
						PERFORM auth.revoke_school_sessions(hidden_school);
					END IF;
					UPDATE platform.schools AS school SET deleted_at = NOW()
						FROM platform.demo_school_states AS state
						WHERE state.name = target_name
							AND (state.status = 'ready' OR (state.status = 'preparing' AND state.claimed_at IS NULL))
							AND (school.id = state.tenant_id OR school.organization_id = state.traeger_id)
							AND school.deleted_at IS NULL;
					GET DIAGNOSTICS changed = ROW_COUNT;
					-- The Träger goes out of service with its schools: every Träger
					-- session, minted or validated, needs an active Träger, so none
					-- outlives the retirement, also not one a redemption mints
					-- concurrently (it waits for the account lock above).
					UPDATE platform.organizations SET active = false
						WHERE id = hidden_traeger AND active;
					UPDATE platform.demo_school_states AS state SET status = 'failed'
						WHERE state.name = target_name AND state.status = 'preparing' AND state.claimed_at IS NULL
							AND NOT EXISTS (SELECT 1 FROM auth.demo_accesses AS access WHERE access.school_slug = state.name);
					hidden_count := hidden_count + changed;
				EXCEPTION WHEN lock_not_available OR deadlock_detected THEN
					PERFORM platform.defer_demo_order(target_name, 'retirement', SQLSTATE);
				END;
			END LOOP;
			hidden := hidden_count;
			erased := platform.erase_closed_demo_visitors();
			RETURN NEXT;
		END;
		$$;
`
