package migrations

import (
	"testing"

	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/require"
)

// Migration 20261126090000 keeps the guardian account that asked for the
// day's pickup person (#8162); deleting the account keeps the day value
// without its author.
func TestPickupPersonRequestedByGuardianSurvivesTheAccount(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	ctx := testpkg.Ctx(t)
	tenantID := testpkg.Tenant(t)
	student := testpkg.CreateTestStudent(t, db, "Mila", "Anfrage", "3a")
	account := testpkg.CreateTestAccount(t, db, "parent")
	var id int64
	require.NoError(t, db.NewRaw(`INSERT INTO schedule.student_pickup_persons (tenant_id, student_id, exception_date, person_name, requested_by_guardian)
		VALUES (?, ?, '2026-09-09', 'Tante Frieda', ?) RETURNING id`, tenantID, student.ID, account.ID).Scan(ctx, &id))

	_, err := db.ExecContext(ctx, `DELETE FROM auth.accounts WHERE id = ?`, account.ID)
	require.NoError(t, err)
	var requestedBy *int64
	require.NoError(t, db.NewRaw(`SELECT requested_by_guardian FROM schedule.student_pickup_persons WHERE tenant_id = ? AND id = ?`, tenantID, id).Scan(ctx, &requestedBy))
	require.Nil(t, requestedBy)
}
