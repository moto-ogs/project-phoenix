package migrations

import (
	"context"
	"fmt"
	"strings"

	"github.com/uptrace/bun"
)

const roomClosuresVersion = "20261125201027"

func init() {
	MigrationRegistry.Register(&Migration{
		Version:     roomClosuresVersion,
		Description: "Raumsperre für einen Tag oder Zeitraum mit Grund (#7653)",
		DependsOn: []string{
			roomsArchiveVersion,         // the last shape of facilities.rooms
			roomHistoryStopsVersion,     // the erasure fingerprint this one follows
			parentBillingIssuersVersion, // the newest migration on development
		},
	})
	Migrations.MustRegister(roomClosuresUp, roomClosuresDown)
}

// facilities.room_closures is the closure of one room for a day or a
// period with its reason (#7653), e.g. a water damage. Facilities owns it
// beside the rooms.
//
//   - The row goes with its room and with the school (ON DELETE CASCADE):
//     a closure is no history that keeps a room.
//   - start_date and end_date are calendar days, both included.
//   - The school erasure learns the table (repeatable school_erasure_*).
const roomClosuresUpSQL = `
CREATE TABLE facilities.room_closures (
	id BIGSERIAL PRIMARY KEY,
	tenant_id BIGINT NOT NULL REFERENCES platform.schools(id) ON DELETE CASCADE,
	room_id BIGINT NOT NULL,
	start_date DATE NOT NULL,
	end_date DATE NOT NULL,
	reason VARCHAR(200) NOT NULL,
	created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT fk_room_closures_room FOREIGN KEY (tenant_id, room_id)
		REFERENCES facilities.rooms (tenant_id, id) ON DELETE CASCADE,
	CONSTRAINT chk_room_closures_period CHECK (end_date >= start_date),
	CONSTRAINT chk_room_closures_reason CHECK (btrim(reason) <> '')
);
CREATE INDEX idx_room_closures_room_period ON facilities.room_closures (tenant_id, room_id, end_date);
COMMENT ON TABLE facilities.room_closures IS
	'Sperre eines Raums für einen Tag oder Zeitraum mit Grund (#7653): gesperrte Räume sind für neue Termine und am Kiosk nicht wählbar.';

ALTER TABLE facilities.room_closures ENABLE ROW LEVEL SECURITY;
ALTER TABLE facilities.room_closures FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_facilities_room_closures ON facilities.room_closures FOR ALL
	USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::bigint)
	WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::bigint);

REVOKE ALL ON facilities.room_closures FROM PUBLIC, phoenix_tenant;
GRANT SELECT, INSERT, DELETE ON facilities.room_closures TO phoenix_tenant;
GRANT USAGE ON SEQUENCE facilities.room_closures_id_seq TO phoenix_tenant;
GRANT ALL ON facilities.room_closures TO phoenix_admin;
GRANT USAGE ON SEQUENCE facilities.room_closures_id_seq TO phoenix_admin;
`

func roomClosuresUp(ctx context.Context, db *bun.DB) error {
	if _, err := db.ExecContext(ctx, roomClosuresUpSQL); err != nil {
		return fmt.Errorf("create facilities.room_closures: %w", err)
	}
	return nil
}

// roomClosuresFingerprint is the incoming-FK fingerprint of the school
// erasure plan with the closures; the repeatable preflight checks it.
const roomClosuresFingerprint = "d207bc6ee1f1edbdb57fda3c597880f71680ca954d95119c6b9d469f8ad6dc3c"

// roomClosuresErasureLines are the lines the repeatable school erasure
// carries for the closures, per function. The down takes them out of the
// installed functions again, so an erasure after the rollback still runs.
var roomClosuresErasureLines = map[string]string{
	"platform.school_erasure_plan()":                     `  {"name": "facilities.room_closures","predicate": "r.tenant_id = $1"},` + "\n",
	"platform.school_erasure_preflight(bigint,bigint)":   "    facilities.room_closures,\n",
	"platform.school_erasure_assert_empty(bigint,jsonb)": "    SELECT 1 FROM facilities.room_closures AS r WHERE r.tenant_id = p_school_id\n    UNION ALL\n",
	"platform.school_erasure_delete(bigint)": "   SELECT count(*) INTO v_count FROM facilities.room_closures AS r WHERE r.tenant_id = p_school_id; " +
		"DELETE FROM facilities.room_closures AS r WHERE r.tenant_id = p_school_id; " +
		"v_counts := v_counts || jsonb_build_object('facilities.room_closures', v_count);\n",
}

// roomClosuresDown drops the closures and takes the table out of the
// installed school erasure, pointing its preflight back at the fingerprint
// before it.
func roomClosuresDown(ctx context.Context, db *bun.DB) error {
	return db.RunInTx(ctx, nil, func(ctx context.Context, tx bun.Tx) error {
		restored := make([]string, 0, len(roomClosuresErasureLines))
		for function, line := range roomClosuresErasureLines {
			var definition string
			if err := tx.NewRaw(`SELECT pg_get_functiondef(?::regprocedure)`, function).Scan(ctx, &definition); err != nil {
				return fmt.Errorf("read %s: %w", function, err)
			}
			if strings.Count(definition, line) != 1 {
				continue
			}
			definition = strings.Replace(definition, line, "", 1)
			definition = strings.Replace(definition, "'"+roomClosuresFingerprint+"'", "'"+roomHistoryStopsFingerprint+"'", 1)
			restored = append(restored, definition)
		}
		if err := installDerivedSchoolErasureFunctions(ctx, tx, restored); err != nil {
			return fmt.Errorf("take the room closures out of the school erasure: %w", err)
		}
		if _, err := tx.ExecContext(ctx, `DROP TABLE IF EXISTS facilities.room_closures;`); err != nil {
			return fmt.Errorf("drop facilities.room_closures: %w", err)
		}
		return nil
	})
}
