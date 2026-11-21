package test

import (
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// DepartureExceptionFixture is test-owned setup data for the Abholart of one
// child on one day (schedule.student_departure_exceptions).
type DepartureExceptionFixture struct {
	ID            int64 `bun:"id,pk,autoincrement"`
	TenantID      int64
	StudentID     int64
	ExceptionDate calendar.Date `bun:"exception_date,notnull,type:date"`
	DepartureMode string
	Reason        *string
	CreatedBy     *int64
}

// CreateTestDepartureException sets the Abholart of a child for one day,
// e.g. "alone" for a child who goes home alone that day.
func CreateTestDepartureException(tb testing.TB, db *bun.DB, studentID int64, date calendar.Date, staffID int64, mode, reason string) *DepartureExceptionFixture {
	tb.Helper()
	row := &DepartureExceptionFixture{StudentID: studentID, ExceptionDate: date, DepartureMode: mode, CreatedBy: &staffID}
	if reason != "" {
		row.Reason = &reason
	}
	row.TenantID = fixtureTenantID(tb)

	ctx, cancel := fixtureCtx()
	defer cancel()
	_, err := db.NewInsert().Model(row).ModelTableExpr(`schedule.student_departure_exceptions`).Exec(ctx)
	require.NoError(tb, err, "Failed to create test departure exception")
	return row
}
