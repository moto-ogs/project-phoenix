package compose

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"

	"github.com/moto-ogs/project-phoenix/modules/peopledirectory"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/tenant"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// The child records a link of imported contracts names (#7760): one read in
// the school's tenant transaction, with names and date of birth, a child
// whose care ended included, a deleted one and one of another school not.
func TestStudentRecordIdentitiesReadTheSchoolsOwnChildrenByIdentifier(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	school := testpkg.Tenant(t)
	current := testpkg.CreateTestStudentForTenant(t, db, school, "Mia", "Beispiel", "1a")
	alumnus := testpkg.CreateTestStudentForTenant(t, db, school, "Ben", "Beispiel", "4a")
	deleted := testpkg.CreateTestStudentForTenant(t, db, school, "Ole", "Beispiel", "2a")
	foreign := testpkg.CreateTestStudentForTenant(t, db, otherSchool(t, db), "Lea", "Beispiel", "1a")
	ctx := context.Background()
	for _, statement := range []struct {
		sql string
		id  int64
	}{
		{`UPDATE users.persons SET birthday = DATE '2019-05-03' WHERE id = (SELECT person_id FROM users.student_profiles WHERE id = ?)`, current.ID},
		{`UPDATE users.student_school_memberships SET status = 'alumnus', enrolled_until = DATE '2026-07-31' WHERE student_profile_id = ?`, alumnus.ID},
		{`UPDATE users.student_school_memberships SET deleted_at = NOW() WHERE student_profile_id = ?`, deleted.ID},
	} {
		_, err := db.ExecContext(ctx, statement.sql, statement.id)
		require.NoError(t, err)
	}

	reads := NewStudentRecordIdentities(testpkg.StudentDirectory{})
	id, err := tenant.NewTenantID(school)
	require.NoError(t, err)
	var found []peopledirectory.StudentRecordIdentity
	require.NoError(t, tenant.WithinTenant(tenant.WithUnitOfWork(ctx, testpkg.TenantRuntime(t, db)), id, func(txCtx context.Context) error {
		found, err = reads.StudentRecordIdentities(txCtx, []int64{current.ID, alumnus.ID, deleted.ID, foreign.ID})
		return err
	}))
	born := calendar.NewDate(2019, 5, 3)
	assert.Equal(t, []peopledirectory.StudentRecordIdentity{
		{StudentID: current.ID, FirstName: "Mia", LastName: "Beispiel", Birthday: &born},
		{StudentID: alumnus.ID, FirstName: "Ben", LastName: "Beispiel"},
	}, found)
}

func otherSchool(t *testing.T, db *bun.DB) int64 {
	t.Helper()
	id, _ := testpkg.CreateTestTenant(t, db)
	return id
}
