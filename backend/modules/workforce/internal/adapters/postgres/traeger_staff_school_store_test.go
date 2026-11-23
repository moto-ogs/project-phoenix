package postgres

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// A hold stamps the school's bank row past every link written before it, on
// the database clock that stamps linked_at: the next hand-over of the record
// tells the held row from one the link read by that order alone.
func TestHoldSchoolFinancialRowStampsTheRowAfterTheLink(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	school := testpkg.Tenant(t)
	staff := testpkg.CreateTestStaff(t, db, "Mira", "Halt")
	ctx := testpkg.Ctx(t)
	_, err := db.ExecContext(ctx, `INSERT INTO users.staff_financial_data (tenant_id, staff_id, iban_sealed, iban_masked) VALUES (?, ?, ?, ?)`,
		school, staff.ID, []byte("sealed"), "•••• 4711")
	require.NoError(t, err)
	var linkedAt time.Time
	require.NoError(t, db.NewRaw(`SELECT now()`).Scan(ctx, &linkedAt))

	store := NewTraegerStaffStore()
	require.NoError(t, testpkg.WithinTenantContext(t, ctx, db, school, func(ctx context.Context) error {
		return store.HoldSchoolFinancialRow(ctx, staff.ID)
	}))
	require.NoError(t, testpkg.WithinTenantContext(t, ctx, db, school, func(ctx context.Context) error {
		rows, err := store.SchoolFinancialRows(ctx, []int64{staff.ID})
		require.NoError(t, err)
		require.Len(t, rows, 1)
		require.True(t, rows[0].UpdatedAt.After(linkedAt), "held at %s, linked at %s", rows[0].UpdatedAt, linkedAt)
		return nil
	}))
}
