package test

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// CreateTestStudentStatusDayForTenant is CreateTestStudentStatusDay at the
// given school, for tests that compare several schools.
func CreateTestStudentStatusDayForTenant(tb testing.TB, db *bun.DB, tenantID, studentID int64, date calendar.Date, status string) *StudentStatusDayRow {
	tb.Helper()

	row := &StudentStatusDayRow{
		StudentID:  studentID,
		Date:       date,
		Status:     status,
		ReportedAt: time.Now(),
		Source:     "manual", // absencerecords.StudentStatusSourceManual
	}
	row.TenantID = tenantID

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	_, err := db.NewInsert().
		Model(row).
		ModelTableExpr(`active.student_status_days`).
		Exec(ctx)
	require.NoError(tb, err, "Failed to create test student status day")
	return row
}
