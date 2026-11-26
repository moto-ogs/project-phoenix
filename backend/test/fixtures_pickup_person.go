package test

import (
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// PickupPersonFixture is test-owned setup data for who collects one child on
// one day (schedule.student_pickup_persons, #7655).
type PickupPersonFixture struct {
	ID                int64 `bun:"id,pk,autoincrement"`
	TenantID          int64
	StudentID         int64
	ExceptionDate     calendar.Date `bun:"exception_date,notnull,type:date"`
	PersonName        string
	GuardianProfileID *int64
	CreatedBy         *int64
}

// CreateTestPickupPerson names who collects a child on one day. A zero
// guardianProfileID is a one-time person known by name only; a zero staffID
// leaves the author empty.
func CreateTestPickupPerson(tb testing.TB, db *bun.DB, studentID int64, date calendar.Date, staffID int64, name string, guardianProfileID int64) *PickupPersonFixture {
	tb.Helper()
	row := &PickupPersonFixture{StudentID: studentID, ExceptionDate: date, PersonName: name}
	if staffID > 0 {
		row.CreatedBy = &staffID
	}
	if guardianProfileID > 0 {
		row.GuardianProfileID = &guardianProfileID
	}
	row.TenantID = fixtureTenantID(tb)

	ctx, cancel := fixtureCtx()
	defer cancel()
	_, err := db.NewInsert().Model(row).ModelTableExpr(`schedule.student_pickup_persons`).Exec(ctx)
	require.NoError(tb, err, "Failed to create test pickup person")
	return row
}
