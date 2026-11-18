package owners

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	organizationCompose "github.com/moto-ogs/project-phoenix/modules/organizationtenancy/compose"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// The reminders read their school under a share lock (#7478): a retirement
// that would hide the school while they run waits for them, and a school
// hidden before they ran reads as retired.
func TestReminderSchoolsHoldTheSchoolAndReadARetiredOne(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	ctx := testpkg.ContextWithTenantRuntime(context.Background(), testpkg.TenantRuntime(t, db))
	organizations, err := organizationCompose.New(organizationCompose.Dependencies{DB: db, Observe: func(organizationCompose.Observation) {}})
	require.NoError(t, err)
	schools := payrollSchools{schools: organizations, hold: true}
	organization := testpkg.CreateTestOrganization(t, db, &testpkg.Organization{Name: "Träger Erinnerungen", Slug: fmt.Sprintf("traeger-erinnerungen-%d", time.Now().UnixNano())})
	live := testpkg.CreateTestSchoolInOrganization(t, db, organization.ID, "OGS Offen")
	retired := testpkg.CreateTestSchoolInOrganization(t, db, organization.ID, "OGS Stillgelegt")
	_, err = db.ExecContext(ctx, `UPDATE platform.schools SET deleted_at = NOW() WHERE id = ?`, retired)
	require.NoError(t, err)

	require.NoError(t, testpkg.WithinCurrentTenant(testpkg.ContextForTenant(ctx, retired), func(txCtx context.Context) error {
		school, err := schools.School(txCtx, retired)
		require.NoError(t, err)
		assert.True(t, school.Retired, "a school hidden before the run reads as retired")
		return nil
	}))

	require.NoError(t, testpkg.WithinCurrentTenant(testpkg.ContextForTenant(ctx, live), func(txCtx context.Context) error {
		school, err := schools.School(txCtx, live)
		require.NoError(t, err)
		assert.False(t, school.Retired)
		assert.Equal(t, "OGS Offen", school.Name)
		// The retirement's hiding waits for this transaction; with its
		// lock_timeout it gives up and defers the order.
		tx, err := db.BeginTx(context.Background(), nil)
		require.NoError(t, err)
		defer func() { _ = tx.Rollback() }()
		_, err = tx.ExecContext(context.Background(), `SET LOCAL lock_timeout = '100ms'`)
		require.NoError(t, err)
		_, err = tx.ExecContext(context.Background(), `UPDATE platform.schools SET deleted_at = NOW() WHERE id = ?`, live)
		require.ErrorContains(t, err, "lock timeout", "the reminders hold their school until they commit")
		return nil
	}))
}
