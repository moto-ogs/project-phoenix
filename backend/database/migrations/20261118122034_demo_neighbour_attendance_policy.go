package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

const demoNeighbourAttendancePolicyVersion = "20261118122034"

func init() {
	MigrationRegistry.Register(&Migration{
		Version:     demoNeighbourAttendancePolicyVersion,
		Description: "Demo-Anwesenheiten auch an den Schulen des Besuchs lesen",
		DependsOn:   []string{demoVisitorErasureVersion},
	})
	Migrations.MustRegister(demoNeighbourAttendancePolicyUp, demoNeighbourAttendancePolicyDown)
}

func demoNeighbourAttendancePolicyUp(ctx context.Context, db *bun.DB) error {
	// The existing school scope still applies. This second, restrictive
	// policy limits the demo role to schools registered on demo orders.
	_, err := db.ExecContext(ctx, `
		ALTER POLICY demo_runtime_attendance ON active.attendance
		USING (tenant_id IN (
			SELECT tenant_id FROM platform.demo_school_states
			UNION ALL
			SELECT unnest(visitor_school_ids) FROM platform.demo_school_states
		))
	`)
	if err != nil {
		return fmt.Errorf("allow demo attendance for registered visitor schools: %w", err)
	}
	return nil
}

func demoNeighbourAttendancePolicyDown(ctx context.Context, db *bun.DB) error {
	_, err := db.ExecContext(ctx, `
		ALTER POLICY demo_runtime_attendance ON active.attendance
		USING (tenant_id IN (SELECT tenant_id FROM platform.demo_school_states))
	`)
	if err != nil {
		return fmt.Errorf("restore demo attendance scope to primary schools: %w", err)
	}
	return nil
}
