package migrations

import (
	"context"
	"fmt"
	"strings"

	"github.com/uptrace/bun"
)

const mealCancellationsVersion = "20261125201053"

func init() {
	MigrationRegistry.Register(&Migration{
		Version:     mealCancellationsVersion,
		Description: "Speiseplan: Ausfall des Mittagessens an einzelnen Tagen (#7656)",
		DependsOn: []string{
			mealPlanMenuChangedAtVersion, // the last change of the meal plan's tables
			roomClosuresVersion,          // the earlier erasure extension at the head
		},
	})
	Migrations.MustRegister(mealCancellationsUp, mealCancellationsDown)
}

// schedule.meal_cancellations is the day on which lunch does not take place
// although the school is open (#7656), with the school's reason ("Der
// Caterer liefert nicht"). Meal Plan owns it beside the menu. At most one
// row per school and day; the school removes it to let lunch take place
// again. The Meal Plan treats the day like a closed day: the bookings of the
// day lapse, the kitchen list is empty, the month does not count it.
//
//   - The row names no person: who entered it is not kept.
//   - The row goes with the school (repeatable school_erasure_*).
const mealCancellationsUpSQL = `
CREATE TABLE schedule.meal_cancellations (
	tenant_id BIGINT NOT NULL REFERENCES platform.schools(id),
	date DATE NOT NULL,
	reason TEXT NOT NULL,
	created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY (tenant_id, date),
	CONSTRAINT chk_meal_cancellations_reason CHECK (BTRIM(reason) = reason AND char_length(reason) BETWEEN 1 AND 200)
);
COMMENT ON TABLE schedule.meal_cancellations IS
	'Tage, an denen das Mittagessen ausfällt, obwohl die Schule geöffnet ist (#7656), mit dem Grund der Schule.';

ALTER TABLE schedule.meal_cancellations ENABLE ROW LEVEL SECURITY;
ALTER TABLE schedule.meal_cancellations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_schedule_meal_cancellations ON schedule.meal_cancellations FOR ALL
	USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::bigint)
	WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::bigint);

REVOKE ALL ON schedule.meal_cancellations FROM PUBLIC, phoenix_tenant;
GRANT SELECT, INSERT, UPDATE, DELETE ON schedule.meal_cancellations TO phoenix_tenant;
GRANT ALL ON schedule.meal_cancellations TO phoenix_admin;
`

func mealCancellationsUp(ctx context.Context, db *bun.DB) error {
	if _, err := db.ExecContext(ctx, mealCancellationsUpSQL); err != nil {
		return fmt.Errorf("create schedule.meal_cancellations: %w", err)
	}
	return nil
}

// mealCancellationsFingerprint is the incoming-FK fingerprint of the school
// erasure plan with the meal cancellations; the repeatable preflight checks
// it.
const mealCancellationsFingerprint = "1f3244143251459a1f23877478b1ec4033ee9138195c06b37a0af87a45267ab5"

// mealCancellationsErasureLines are the lines the repeatable school erasure
// carries for the meal cancellations, per function. The down takes them out
// of the installed functions again, so an erasure after the rollback still
// runs.
var mealCancellationsErasureLines = map[string]string{
	"platform.school_erasure_plan()":                     `  {"name": "schedule.meal_cancellations","predicate": "r.tenant_id = $1"},` + "\n",
	"platform.school_erasure_preflight(bigint,bigint)":   "    schedule.meal_cancellations,\n",
	"platform.school_erasure_assert_empty(bigint,jsonb)": "    SELECT 1 FROM schedule.meal_cancellations AS r WHERE r.tenant_id = p_school_id\n    UNION ALL\n",
	"platform.school_erasure_delete(bigint)": "   SELECT count(*) INTO v_count FROM schedule.meal_cancellations AS r WHERE r.tenant_id = p_school_id; " +
		"DELETE FROM schedule.meal_cancellations AS r WHERE r.tenant_id = p_school_id; " +
		"v_counts := v_counts || jsonb_build_object('schedule.meal_cancellations', v_count);\n",
}

// mealCancellationsDown drops the table and takes it out of the installed
// school erasure, pointing its preflight back at the fingerprint before it.
func mealCancellationsDown(ctx context.Context, db *bun.DB) error {
	return db.RunInTx(ctx, nil, func(ctx context.Context, tx bun.Tx) error {
		restored, err := mealCancellationsErasureWithout(ctx, tx)
		if err != nil {
			return err
		}
		if err := installDerivedSchoolErasureFunctions(ctx, tx, restored); err != nil {
			return fmt.Errorf("take the meal cancellations out of the school erasure: %w", err)
		}
		if _, err := tx.ExecContext(ctx, `DROP TABLE IF EXISTS schedule.meal_cancellations;`); err != nil {
			return fmt.Errorf("drop schedule.meal_cancellations: %w", err)
		}
		return nil
	})
}

// mealCancellationsErasureWithout returns the installed school erasure
// functions that name the meal cancellations, each without them. An older
// erasure that never knew them is left as it is.
func mealCancellationsErasureWithout(ctx context.Context, tx bun.Tx) ([]string, error) {
	restored := make([]string, 0, len(mealCancellationsErasureLines))
	for function, line := range mealCancellationsErasureLines {
		var definition string
		if err := tx.NewRaw(`SELECT pg_get_functiondef(?::regprocedure)`, function).Scan(ctx, &definition); err != nil {
			return nil, fmt.Errorf("read %s: %w", function, err)
		}
		if strings.Count(definition, line) != 1 {
			continue
		}
		definition = strings.Replace(definition, line, "", 1)
		definition = strings.Replace(definition, "'"+mealCancellationsFingerprint+"'", "'"+roomClosuresFingerprint+"'", 1)
		restored = append(restored, definition)
	}
	return restored, nil
}
