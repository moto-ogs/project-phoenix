package test

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// CreateTestGroupSupervisorOn creates the supervision of
// CreateTestGroupSupervisor starting on a given day, for tests that run the
// product on a fixed clock.
func CreateTestGroupSupervisorOn(tb testing.TB, db *bun.DB, staffID, activeGroupID int64, role string, start calendar.Date) *GroupSupervisorRow {
	tb.Helper()

	supervisor := &GroupSupervisorRow{
		StaffID:   staffID,
		GroupID:   activeGroupID,
		Role:      role,
		StartDate: start,
	}
	supervisor.TenantID = fixtureTenantID(tb)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	err := db.NewInsert().
		Model(supervisor).
		ModelTableExpr(`active.group_supervisors`).
		Scan(ctx)
	require.NoError(tb, err, "Failed to create test group supervisor")

	return supervisor
}
