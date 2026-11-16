package migrations

import (
	"context"

	"github.com/uptrace/bun"
)

func init() {
	RegisterRepeatable("platform.school_erasure_preview", func(ctx context.Context, tx bun.Tx) error {
		_, err := tx.ExecContext(ctx, repeatablePlatformSchoolErasurePreviewSQL)
		return err
	})
}

// repeatablePlatformSchoolErasurePreviewSQL is the current definition of
// platform.school_erasure_preview(bigint,bigint) (ADR 0223). Change the function
// here; numbered migrations no longer define it. It counts the targets of
// platform.school_erasure_plan(): a table enters the preview by entering the
// plan, so a new table needs no statement here.
const repeatablePlatformSchoolErasurePreviewSQL = `CREATE OR REPLACE FUNCTION platform.school_erasure_preview(p_school bigint, p_operator bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
 DECLARE v_counts JSONB := '{}'; v_entry JSONB; v_count BIGINT;
 BEGIN
 IF NOT EXISTS (SELECT FROM platform.operators WHERE id=p_operator AND active) THEN
 RAISE EXCEPTION 'active operator required' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS (SELECT FROM platform.schools WHERE id=p_school) THEN
 RAISE EXCEPTION 'existing school required' USING ERRCODE='22023'; END IF;
 -- The targets and selectors come from the installed erasure plan, so the
 -- preview and the plan the run executes cannot drift apart (#7210). Names are cast to
 -- regclass and the selectors are the plan's own fixed text; the statement
 -- only counts rows.
 FOR v_entry IN SELECT value FROM jsonb_array_elements(platform.school_erasure_plan()) LOOP
 EXECUTE format('SELECT count(*) FROM %s AS r WHERE %s', (v_entry->>'name')::regclass, v_entry->>'predicate')
 INTO v_count USING p_school;
 v_counts := v_counts || jsonb_build_object(v_entry->>'name', v_count);
 END LOOP;
 RETURN v_counts;
 END $function$
`
