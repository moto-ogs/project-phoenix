package migrations

import (
	"context"
	"fmt"
	"strings"

	"github.com/uptrace/bun"
)

const deviceLifecycleEventsVersion = "20261118150000"

func init() {
	MigrationRegistry.Register(&Migration{
		Version:     deviceLifecycleEventsVersion,
		Description: "Verlauf der Geräte: wer hat wann was an einem Gerät geändert (#2321)",
		DependsOn: []string{
			demoNeighbourAttendancePolicyVersion,
			parentLetterCopiesVersion, // the erasure fingerprint this one follows
		},
	})
	Migrations.MustRegister(deviceLifecycleEventsUp, deviceLifecycleEventsDown)
}

// audit.device_lifecycle_events is the Gerätelebenszyklus of Device Fleet
// (#2321): every effective change to a device, the account or operator who
// made it, when, and the material values before and after. It never holds a
// credential, a MAC address, a PIN or a child. Rows are only added; they go
// with their school. The actor is only a reference: the staff account or
// the operator, set to NULL when that account or operator goes, like
// iot.devices.registered_by_id. Names are read from the people directory
// when the history is shown, never stored here.
const deviceLifecycleEventsUpSQL = `
CREATE TABLE audit.device_lifecycle_events (
	id BIGSERIAL PRIMARY KEY,
	tenant_id BIGINT NOT NULL REFERENCES platform.schools(id),
	device_id BIGINT NOT NULL REFERENCES iot.devices(id),
	action TEXT NOT NULL,
	actor_kind TEXT NOT NULL,
	actor_account_id BIGINT REFERENCES auth.accounts(id) ON DELETE SET NULL,
	actor_operator_id BIGINT REFERENCES platform.operators(id) ON DELETE SET NULL,
	changes JSONB NOT NULL DEFAULT '{}'::jsonb,
	occurred_at TIMESTAMPTZ NOT NULL,
	CONSTRAINT chk_device_lifecycle_events_action CHECK (action IN (
		'created', 'updated', 'blocked', 'unblocked', 'status_changed',
		'key_rotated', 'removed', 'transferred_out', 'transferred_in')),
	CONSTRAINT chk_device_lifecycle_events_actor CHECK (
		(actor_kind = 'school_staff' AND actor_operator_id IS NULL)
		OR (actor_kind = 'operator' AND actor_account_id IS NULL)),
	CONSTRAINT chk_device_lifecycle_events_changes CHECK (jsonb_typeof(changes) = 'object')
);
CREATE INDEX idx_device_lifecycle_events_device
	ON audit.device_lifecycle_events (tenant_id, device_id, occurred_at DESC, id DESC);
CREATE INDEX idx_device_lifecycle_events_account
	ON audit.device_lifecycle_events (actor_account_id) WHERE actor_account_id IS NOT NULL;
CREATE INDEX idx_device_lifecycle_events_operator
	ON audit.device_lifecycle_events (actor_operator_id) WHERE actor_operator_id IS NOT NULL;
COMMENT ON TABLE audit.device_lifecycle_events IS
	'Gerätelebenszyklus of Device Fleet (#2321): who changed which device when, with the values before and after; no credentials; only added.';

ALTER TABLE audit.device_lifecycle_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit.device_lifecycle_events FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_audit_device_lifecycle_events ON audit.device_lifecycle_events FOR ALL
	USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::bigint)
	WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::bigint);

REVOKE ALL ON audit.device_lifecycle_events FROM PUBLIC, phoenix_tenant;
GRANT SELECT, INSERT ON audit.device_lifecycle_events TO phoenix_tenant;
GRANT USAGE ON SEQUENCE audit.device_lifecycle_events_id_seq TO phoenix_tenant;
GRANT ALL ON audit.device_lifecycle_events TO phoenix_admin;
GRANT ALL ON SEQUENCE audit.device_lifecycle_events_id_seq TO phoenix_admin;
`

func deviceLifecycleEventsUp(ctx context.Context, db *bun.DB) error {
	if _, err := db.ExecContext(ctx, deviceLifecycleEventsUpSQL); err != nil {
		return fmt.Errorf("create audit.device_lifecycle_events: %w", err)
	}
	return nil
}

// deviceLifecycleEventsFingerprint is the incoming-FK fingerprint of the
// school erasure plan with the device history; the repeatable preflight
// checks it.
const deviceLifecycleEventsFingerprint = "2a733e9a271eec1ff8bc41955d90a411438969a0bf87e3fca7422ca9dbbc9cf7"

// deviceLifecycleEventsErasureLines are the lines the repeatable school
// erasure carries for the history, per function. The down takes them out of
// the installed functions again, so an erasure after the rollback still
// runs.
var deviceLifecycleEventsErasureLines = map[string]string{
	"platform.school_erasure_plan()":                     `  {"name": "audit.device_lifecycle_events","predicate": "r.tenant_id = $1"},` + "\n",
	"platform.school_erasure_preflight(bigint,bigint)":   "    audit.device_lifecycle_events,\n",
	"platform.school_erasure_assert_empty(bigint,jsonb)": "    SELECT 1 FROM audit.device_lifecycle_events AS r WHERE r.tenant_id = p_school_id\n    UNION ALL\n",
	"platform.school_erasure_delete(bigint)": "   SELECT count(*) INTO v_count FROM audit.device_lifecycle_events AS r WHERE r.tenant_id = p_school_id; " +
		"DELETE FROM audit.device_lifecycle_events AS r WHERE r.tenant_id = p_school_id; " +
		"v_counts := v_counts || jsonb_build_object('audit.device_lifecycle_events', v_count);\n",
}

// deviceLifecycleEventsScopeCheck is the preflight's incoming-FK scope check
// of the history; the down takes it out with the table.
const deviceLifecycleEventsScopeCheck = `    SELECT 1 FROM audit.device_lifecycle_events AS c JOIN iot.devices AS p ON c."device_id" = p."id" WHERE (p.tenant_id = p_school_id) AND NOT COALESCE((c.tenant_id = p_school_id), FALSE)` + "\n    UNION ALL\n"

// deviceLifecycleEventsDown drops the history and takes it out of the
// installed school erasure, pointing its preflight back at the fingerprint
// before it.
func deviceLifecycleEventsDown(ctx context.Context, db *bun.DB) error {
	return db.RunInTx(ctx, nil, func(ctx context.Context, tx bun.Tx) error {
		restored := make([]string, 0, len(deviceLifecycleEventsErasureLines))
		for function, line := range deviceLifecycleEventsErasureLines {
			var definition string
			if err := tx.NewRaw(`SELECT pg_get_functiondef(?::regprocedure)`, function).Scan(ctx, &definition); err != nil {
				return fmt.Errorf("read %s: %w", function, err)
			}
			if strings.Count(definition, line) != 1 {
				continue // an older erasure is installed; it never knew the history
			}
			definition = strings.Replace(definition, line, "", 1)
			definition = strings.Replace(definition, deviceLifecycleEventsScopeCheck, "", 1)
			definition = strings.Replace(definition, "'"+deviceLifecycleEventsFingerprint+"'", "'"+parentLetterCopiesFingerprint+"'", 1)
			restored = append(restored, definition)
		}
		if err := installDerivedSchoolErasureFunctions(ctx, tx, restored); err != nil {
			return fmt.Errorf("take the device history out of the school erasure: %w", err)
		}
		if _, err := tx.ExecContext(ctx, `DROP TABLE IF EXISTS audit.device_lifecycle_events`); err != nil {
			return fmt.Errorf("drop audit.device_lifecycle_events: %w", err)
		}
		return nil
	})
}
