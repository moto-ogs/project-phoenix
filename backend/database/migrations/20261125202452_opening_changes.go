package migrations

import (
	"context"
	"fmt"
	"strings"

	"github.com/uptrace/bun"
)

const openingChangesVersion = "20261125202452"

func init() {
	MigrationRegistry.Register(&Migration{
		Version:     openingChangesVersion,
		Description: "Geänderte Öffnungszeiten einer Schule an einzelnen Tagen (#7654)",
		DependsOn: []string{
			closingDaysVersion,       // the closing days these days sit beside
			mealCancellationsVersion, // its erasure fingerprint follows the days without lunch
		},
	})
	Migrations.MustRegister(openingChangesUp, openingChangesDown)
}

// openingChangesUpSQL adds the days on which a school opens or closes at
// other times than its regular opening hours (#7654), for example a shorter
// day before the holidays. The regular hours are the settings
// opening_hours.*; a row here replaces them on every day from start_date to
// end_date. A single day has start_date = end_date.
//
// The row belongs to School Calendar like schedule.closing_days and is
// maintained on the same page with the same rights. reason is the name the
// school gives the day („Zeugnisausgabe“), not a reason of a person.
// Overlapping rows are not refused, as with the closing days. The school
// erasure learns the table (repeatable school_erasure_*); it goes with the
// school (ON DELETE CASCADE).
const openingChangesUpSQL = `
CREATE TABLE schedule.opening_changes (
	id         BIGSERIAL PRIMARY KEY,
	tenant_id  BIGINT NOT NULL REFERENCES platform.schools(id) ON DELETE CASCADE,
	start_date DATE NOT NULL,
	end_date   DATE NOT NULL,
	opens_at   TIME NOT NULL,
	closes_at  TIME NOT NULL,
	reason     TEXT NOT NULL,
	created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
	updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
	CONSTRAINT chk_opening_changes_range CHECK (start_date <= end_date),
	CONSTRAINT chk_opening_changes_hours CHECK (opens_at < closes_at),
	CONSTRAINT chk_opening_changes_reason CHECK (btrim(reason) <> '' AND char_length(reason) <= 255)
);
CREATE INDEX idx_opening_changes_tenant_range ON schedule.opening_changes (tenant_id, start_date, end_date);
COMMENT ON TABLE schedule.opening_changes IS
	'Days on which a school opens or closes at other times than its regular opening hours (#7654); a row replaces the settings opening_hours.* from start_date to end_date.';

CREATE TRIGGER update_opening_changes_updated_at
	BEFORE UPDATE ON schedule.opening_changes
	FOR EACH ROW EXECUTE FUNCTION update_modified_column();

ALTER TABLE schedule.opening_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE schedule.opening_changes FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_schedule_opening_changes ON schedule.opening_changes FOR ALL
	USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::bigint)
	WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::bigint);

REVOKE ALL ON schedule.opening_changes FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON schedule.opening_changes TO phoenix_tenant;
GRANT USAGE ON SEQUENCE schedule.opening_changes_id_seq TO phoenix_tenant;
`

// openingChangesFingerprint is the incoming-FK fingerprint of the school
// erasure plan with the opening changes and days without lunch; the repeatable
// preflight checks it.
const openingChangesFingerprint = "3515c196a607918b21a1f3172f1c189d0aff66d3837746e4e3480d2e6cf8e12f"

// openingChangesErasureLines are the lines the repeatable school erasure
// carries for the opening changes, per function. The down takes them out of
// the installed functions again, so an erasure after the rollback still runs.
var openingChangesErasureLines = map[string]string{
	"platform.school_erasure_plan()":                     `  {"name": "schedule.opening_changes","predicate": "r.tenant_id = $1"},` + "\n",
	"platform.school_erasure_preflight(bigint,bigint)":   "    schedule.opening_changes,\n",
	"platform.school_erasure_assert_empty(bigint,jsonb)": "    UNION ALL\n    SELECT 1 FROM schedule.opening_changes AS r WHERE r.tenant_id = p_school_id\n",
	"platform.school_erasure_delete(bigint)": "   SELECT count(*) INTO v_count FROM schedule.opening_changes AS r WHERE r.tenant_id = p_school_id; " +
		"DELETE FROM schedule.opening_changes AS r WHERE r.tenant_id = p_school_id; " +
		"v_counts := v_counts || jsonb_build_object('schedule.opening_changes', v_count);\n",
}

func openingChangesUp(ctx context.Context, db *bun.DB) error {
	return db.RunInTx(ctx, nil, func(ctx context.Context, tx bun.Tx) error {
		if _, err := tx.ExecContext(ctx, openingChangesUpSQL); err != nil {
			return fmt.Errorf("create schedule.opening_changes: %w", err)
		}
		return nil
	})
}

// openingChangesDown drops the table and takes it out of the installed
// school erasure, pointing its preflight back at the fingerprint before it.
func openingChangesDown(ctx context.Context, db *bun.DB) error {
	return db.RunInTx(ctx, nil, func(ctx context.Context, tx bun.Tx) error {
		restored, err := openingChangesErasureWithout(ctx, tx)
		if err != nil {
			return err
		}
		if err := installDerivedSchoolErasureFunctions(ctx, tx, restored); err != nil {
			return fmt.Errorf("take the opening changes out of the school erasure: %w", err)
		}
		if _, err := tx.ExecContext(ctx, `DROP TABLE IF EXISTS schedule.opening_changes;`); err != nil {
			return fmt.Errorf("drop schedule.opening_changes: %w", err)
		}
		return nil
	})
}

// openingChangesErasureWithout returns the installed school erasure
// functions that name the opening changes, each without them. An older
// erasure that never knew them is left as it is.
func openingChangesErasureWithout(ctx context.Context, tx bun.Tx) ([]string, error) {
	restored := make([]string, 0, len(openingChangesErasureLines))
	for function, line := range openingChangesErasureLines {
		var definition string
		if err := tx.NewRaw(`SELECT pg_get_functiondef(?::regprocedure)`, function).Scan(ctx, &definition); err != nil {
			return nil, fmt.Errorf("read %s: %w", function, err)
		}
		if strings.Count(definition, line) != 1 {
			continue
		}
		definition = strings.Replace(definition, line, "", 1)
		definition = strings.Replace(definition, "'"+openingChangesFingerprint+"'", "'"+mealCancellationsFingerprint+"'", 1)
		restored = append(restored, definition)
	}
	return restored, nil
}
