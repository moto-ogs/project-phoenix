package migrations

import (
	"context"
	"fmt"
	"strings"

	"github.com/uptrace/bun"
)

const roomHistoryStopsVersion = "20261121090000"

func init() {
	MigrationRegistry.Register(&Migration{
		Version:     roomHistoryStopsVersion,
		Description: "Raumverlauf und Stimmung je Kind stoppen (#3844)",
		DependsOn: []string{
			dropSessionInactivityTimeoutSettingVersion, // the newest migration on development
			deviceLifecycleEventsVersion,               // the erasure fingerprint this one follows
			visitRevisionEventsVersion,                 // the statement triggers on active.visits
			"1.15.399",                                 // users.student_profiles is the child's owner row
		},
	})
	Migrations.MustRegister(roomHistoryStopsUp, roomHistoryStopsDown)
}

// active.room_history_stops is the per-child stop of the room history and
// the mood capture (#3844). Student Presence owns it beside the visits it
// governs. One row per stopped child, holding only when the stop began; who
// set or lifted it goes to the child's change history (audit), not here.
//
//   - The row goes with the child (ON DELETE CASCADE) and with the school.
//   - While a child is stopped, a visit keeps existing only while it is open:
//     the current room stays visible to the supervision. The statement
//     triggers below delete every visit of a stopped child the moment it is
//     written closed, on every path (web, device, timetable, session end,
//     care exit, backfill), so no room history is stored.
//   - The trigger function is SECURITY DEFINER and names the tenant in its
//     own predicate, so a scheduler connection without a tenant setting
//     cannot skip it through RLS.
//   - The school erasure learns the table (repeatable school_erasure_*).
const roomHistoryStopsUpSQL = `
CREATE TABLE active.room_history_stops (
	tenant_id BIGINT NOT NULL REFERENCES platform.schools(id) ON DELETE CASCADE,
	student_id BIGINT NOT NULL,
	stopped_at TIMESTAMPTZ NOT NULL,
	PRIMARY KEY (tenant_id, student_id),
	CONSTRAINT fk_room_history_stops_student FOREIGN KEY (tenant_id, student_id)
		REFERENCES users.student_profiles(tenant_id, id) ON DELETE CASCADE
);
COMMENT ON TABLE active.room_history_stops IS
	'Kinder, für die Raumverlauf und Stimmung gestoppt sind (#3844): nur offene Raumbesuche bleiben bestehen.';

ALTER TABLE active.room_history_stops ENABLE ROW LEVEL SECURITY;
ALTER TABLE active.room_history_stops FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_active_room_history_stops ON active.room_history_stops FOR ALL
	USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::bigint)
	WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::bigint);

REVOKE ALL ON active.room_history_stops FROM PUBLIC, phoenix_tenant;
GRANT SELECT, INSERT, DELETE ON active.room_history_stops TO phoenix_tenant;
GRANT ALL ON active.room_history_stops TO phoenix_admin;

CREATE OR REPLACE FUNCTION active.discard_stopped_room_history() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
	DELETE FROM active.visits AS v
	USING visit_rows_new AS n, active.room_history_stops AS s
	WHERE v.id = n.id AND v.tenant_id = n.tenant_id AND v.exit_time IS NOT NULL
		AND s.tenant_id = n.tenant_id AND s.student_id = n.student_id;
	RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION active.discard_stopped_room_history() FROM PUBLIC;

DROP TRIGGER IF EXISTS discard_stopped_room_history_insert ON active.visits;
CREATE TRIGGER discard_stopped_room_history_insert AFTER INSERT ON active.visits
	REFERENCING NEW TABLE AS visit_rows_new
	FOR EACH STATEMENT EXECUTE FUNCTION active.discard_stopped_room_history();
DROP TRIGGER IF EXISTS discard_stopped_room_history_update ON active.visits;
CREATE TRIGGER discard_stopped_room_history_update AFTER UPDATE ON active.visits
	REFERENCING NEW TABLE AS visit_rows_new
	FOR EACH STATEMENT EXECUTE FUNCTION active.discard_stopped_room_history();
`

func roomHistoryStopsUp(ctx context.Context, db *bun.DB) error {
	if _, err := db.ExecContext(ctx, roomHistoryStopsUpSQL); err != nil {
		return fmt.Errorf("create active.room_history_stops: %w", err)
	}
	return nil
}

// roomHistoryStopsFingerprint is the incoming-FK fingerprint of the school
// erasure plan with the stops; the repeatable preflight checks it.
const roomHistoryStopsFingerprint = "6b46241e82dac28d05c6360467a0729ddd58ed085096b6b9ed693654d4335605"

// roomHistoryStopsErasureLines are the lines the repeatable school erasure
// carries for the stops, per function. The down takes them out of the
// installed functions again, so an erasure after the rollback still runs.
var roomHistoryStopsErasureLines = map[string]string{
	"platform.school_erasure_plan()":                     `  {"name": "active.room_history_stops","predicate": "r.tenant_id = $1"},` + "\n",
	"platform.school_erasure_preflight(bigint,bigint)":   "    active.room_history_stops,\n",
	"platform.school_erasure_assert_empty(bigint,jsonb)": "    SELECT 1 FROM active.room_history_stops AS r WHERE r.tenant_id = p_school_id\n    UNION ALL\n",
	"platform.school_erasure_delete(bigint)": "   SELECT count(*) INTO v_count FROM active.room_history_stops AS r WHERE r.tenant_id = p_school_id; " +
		"DELETE FROM active.room_history_stops AS r WHERE r.tenant_id = p_school_id; " +
		"v_counts := v_counts || jsonb_build_object('active.room_history_stops', v_count);\n",
}

// roomHistoryStopsDemoErasureLines are the lines the repeatable demo
// visitor erasure carries for the stops; the down takes them out too.
const roomHistoryStopsDemoErasureLines = `					-- The per-child stops of room history and mood (#3844).
					DELETE FROM active.room_history_stops
					WHERE tenant_id = ANY (hidden_schools);
`

// roomHistoryStopsDown drops the stops and their triggers and takes the
// table out of the installed school erasure, pointing its preflight back at
// the fingerprint before it.
func roomHistoryStopsDown(ctx context.Context, db *bun.DB) error {
	return db.RunInTx(ctx, nil, func(ctx context.Context, tx bun.Tx) error {
		restored := make([]string, 0, len(roomHistoryStopsErasureLines))
		for function, line := range roomHistoryStopsErasureLines {
			var definition string
			if err := tx.NewRaw(`SELECT pg_get_functiondef(?::regprocedure)`, function).Scan(ctx, &definition); err != nil {
				return fmt.Errorf("read %s: %w", function, err)
			}
			if strings.Count(definition, line) != 1 {
				continue // an older erasure is installed; it never knew the stops
			}
			definition = strings.Replace(definition, line, "", 1)
			definition = strings.Replace(definition, "'"+roomHistoryStopsFingerprint+"'", "'"+deviceLifecycleEventsFingerprint+"'", 1)
			restored = append(restored, definition)
		}
		var demo string
		if err := tx.NewRaw(`SELECT pg_get_functiondef('platform.erase_closed_demo_visitors()'::regprocedure)`).Scan(ctx, &demo); err != nil {
			return fmt.Errorf("read the demo visitor erasure: %w", err)
		}
		if strings.Count(demo, roomHistoryStopsDemoErasureLines) == 1 {
			restored = append(restored, strings.Replace(demo, roomHistoryStopsDemoErasureLines, "", 1))
		}
		if err := installDerivedSchoolErasureFunctions(ctx, tx, restored); err != nil {
			return fmt.Errorf("take the room history stops out of the school erasure: %w", err)
		}
		if _, err := tx.ExecContext(ctx, `
DROP TRIGGER IF EXISTS discard_stopped_room_history_insert ON active.visits;
DROP TRIGGER IF EXISTS discard_stopped_room_history_update ON active.visits;
DROP FUNCTION IF EXISTS active.discard_stopped_room_history();
DROP TABLE IF EXISTS active.room_history_stops;`); err != nil {
			return fmt.Errorf("drop active.room_history_stops: %w", err)
		}
		return nil
	})
}
