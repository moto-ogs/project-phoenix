package migrations

import (
	"testing"

	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/require"
)

// Migration 20261128100000 links a contact's day value to the relationship
// whose pickup permission it rests on (#8206). Every write links it, the
// backfill links the rows saved before, a one-time person has none, and
// unlinking the contact from the child takes the day with it.
func TestPickupPersonRelationshipBackfillsAndGoesWithTheLink(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	ctx := testpkg.Ctx(t)
	tenantID := testpkg.Tenant(t)
	student := testpkg.CreateTestStudent(t, db, "Mila", "Verbindung", "3a")
	grandma := testpkg.CreateTestGuardianProfileNamed(t, db, "Oma", "Berta", "verbindung-oma")
	linked := func(id int64) *int64 {
		t.Helper()
		var relationship *int64
		require.NoError(t, db.NewRaw(`SELECT relationship_id FROM schedule.student_pickup_persons WHERE tenant_id = ? AND id = ?`, tenantID, id).Scan(ctx, &relationship))
		return relationship
	}
	var id, oneTime int64
	require.NoError(t, db.NewRaw(`INSERT INTO schedule.student_pickup_persons (tenant_id, student_id, exception_date, person_name, guardian_profile_id)
		VALUES (?, ?, '2026-09-09', 'Oma Berta', ?) RETURNING id`, tenantID, student.ID, grandma.ID).Scan(ctx, &id))
	require.Nil(t, linked(id), "a contact not linked to the child has no relationship")

	testpkg.CreateTestStudentGuardianLink(t, db, student.ID, grandma.ID, "pickup_only")
	var relationshipID int64
	require.NoError(t, db.NewRaw(`SELECT id FROM users.student_guardian_relationships WHERE tenant_id = ? AND student_id = ? AND guardian_profile_id = ?`,
		tenantID, student.ID, grandma.ID).Scan(ctx, &relationshipID))
	_, err := db.ExecContext(ctx, pickupPersonRelationshipBackfillSQL)
	require.NoError(t, err)
	require.NotNil(t, linked(id), "the backfill links a row written before")
	require.Equal(t, relationshipID, *linked(id))

	require.NoError(t, db.NewRaw(`INSERT INTO schedule.student_pickup_persons (tenant_id, student_id, exception_date, person_name, guardian_profile_id)
		VALUES (?, ?, '2026-09-10', 'Oma Berta', ?) RETURNING id`, tenantID, student.ID, grandma.ID).Scan(ctx, &oneTime))
	require.NotNil(t, linked(oneTime), "every write links the contact")
	_, err = db.ExecContext(ctx, `UPDATE schedule.student_pickup_persons SET guardian_profile_id = NULL WHERE tenant_id = ? AND id = ?`, tenantID, oneTime)
	require.NoError(t, err)
	require.Nil(t, linked(oneTime), "a one-time person has no relationship")

	_, err = db.ExecContext(ctx, `DELETE FROM users.student_guardian_relationships WHERE tenant_id = ? AND id = ?`, tenantID, relationshipID)
	require.NoError(t, err)
	var left int
	require.NoError(t, db.NewRaw(`SELECT count(*) FROM schedule.student_pickup_persons WHERE tenant_id = ? AND id = ?`, tenantID, id).Scan(ctx, &left))
	require.Zero(t, left, "unlinking the contact takes the day with it")
}
