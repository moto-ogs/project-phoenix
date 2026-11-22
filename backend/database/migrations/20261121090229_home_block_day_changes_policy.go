package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

const (
	homeBlockDayChangesPolicyVersion = "20261121090229"
	// homeBlockStaffNoticesKey is the start page block „Hinweise der Leitung“
	// that „Heute anders“ replaces (#7668). The frontend no longer knows it.
	homeBlockStaffNoticesKey = "section.staff_notices"
	homeBlockDayChangesKey   = "section.day_changes"
)

func init() {
	MigrationRegistry.Register(&Migration{
		Version:     homeBlockDayChangesPolicyVersion,
		Description: "Vorgabe der Schule für „Hinweise der Leitung“ auf „Heute anders“ übertragen (#7668)",
		DependsOn:   []string{homeLayoutsVersion},
	})
	Migrations.MustRegister(homeBlockDayChangesPolicyUp, homeBlockDayChangesPolicyDown)
}

// homeBlockDayChangesPolicyUp carries a school's prescription for the removed
// start page block „Hinweise der Leitung“ over to „Heute anders“, which now
// shows the same notices (#7668), and drops the old key.
//
//   - "required" and "disabled" carry over. "optional" is never stored, so
//     there is nothing else to carry.
//   - A school that already prescribed „Heute anders“ itself keeps that
//     choice: it is the newer, explicit decision about this very block.
//   - Personal choices in config.home_layouts stay untouched. „Heute anders“
//     is new content, so a person who had hidden the old block sees it until
//     they hide it again; the frontend ignores the stale key there.
//
// Only rows that still carry the old key match, so a second run changes
// nothing (not even updated_at). The superuser connection bypasses RLS.
// jsonb_exists stands in for the `?` operator, which bun reads as a
// placeholder.
func homeBlockDayChangesPolicyUp(ctx context.Context, db *bun.DB) error {
	if _, err := db.ExecContext(ctx, `
		UPDATE config.home_block_policies
		SET policies = CASE
			WHEN policies->>?0 IN ('required', 'disabled')
				AND NOT jsonb_exists(policies, ?1)
			THEN (policies - ?0) || jsonb_build_object(?1::text, policies->?0)
			ELSE policies - ?0
		END
		WHERE jsonb_exists(policies, ?0)
	`, homeBlockStaffNoticesKey, homeBlockDayChangesKey); err != nil {
		return fmt.Errorf("carry start page block policy to %s: %w", homeBlockDayChangesKey, err)
	}
	return nil
}

// homeBlockDayChangesPolicyDown is a no-op: the old block is gone from the
// frontend, so restoring its key would render nothing, and the carried policy
// cannot be told apart from one the school set for „Heute anders“ itself.
func homeBlockDayChangesPolicyDown(context.Context, *bun.DB) error {
	return nil
}
