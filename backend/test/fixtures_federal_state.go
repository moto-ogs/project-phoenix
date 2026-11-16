package test

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

// TestSchoolFederalState is the Bundesland every fixture school gets. The
// setting has no default (#7174): a real school receives its state when the
// operator creates it, so a fixture school does too. A test of the missing
// state deletes the row.
const TestSchoolFederalState = "DE-NW"

// setTestSchoolFederalState records the fixture school's federal state like
// school creation does; a school that already has one keeps it.
func setTestSchoolFederalState(ctx context.Context, db bun.IDB, schoolID int64) error {
	if _, err := db.ExecContext(ctx, `
		INSERT INTO config.setting_values (tenant_id, setting_key, value)
		VALUES (?, 'operations.federal_state', to_jsonb(?::text))
		ON CONFLICT (tenant_id, setting_key) DO NOTHING`,
		schoolID, TestSchoolFederalState); err != nil {
		return fmt.Errorf("set test school federal state: %w", err)
	}
	return nil
}
