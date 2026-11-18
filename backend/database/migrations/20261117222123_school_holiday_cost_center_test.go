package migrations

import (
	"context"
	"fmt"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// A school keeps a KOST1 of its holiday care beside its KOST1, also from
// the same day (#7357). The down migration removes those rows and their
// scope, and the migration runs up again.
func TestSchoolHolidayCostCenterMigrationRunsDownAndUpAgain(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupIsolatedTestDB(t)
	ctx := context.Background()
	unique := testpkg.UniqueTestTenantID(t)
	organization := testpkg.CreateTestOrganization(t, db, &testpkg.Organization{Name: "Träger Ferien-KOST1",
		Slug: fmt.Sprintf("school-holiday-kost-%d", unique)}).ID
	school := testpkg.CreateTestSchoolInOrganization(t, db, organization, "GS Ispringen")

	add := func(scope string, scopeID int64, code string) error {
		_, err := db.ExecContext(ctx, `INSERT INTO parent_billing.cost_centers (organization_id, scope, scope_id, valid_from, code)
			VALUES (?, ?, ?, DATE '2026-11-04', ?)`, organization, scope, scopeID, code)
		return err
	}
	codes := func() []string {
		var found []string
		require.NoError(t, db.NewRaw(`SELECT code FROM parent_billing.cost_centers WHERE organization_id = ? ORDER BY code`,
			organization).Scan(ctx, &found))
		return found
	}
	require.NoError(t, add("school", school, "5467"))
	require.NoError(t, add("school_holiday", school, "5469"), "its own scope, also from the same day")
	require.Error(t, add("school_holiday", school, "5470"), "one per scope and day")
	require.Error(t, add("school_holiday", 0, "5469"), "the holiday KOST1 names its school")

	require.NoError(t, schoolHolidayCostCenterDown(ctx, db))
	assert.Equal(t, []string{"5467"}, codes(), "the KOST1 of the school stays")
	require.Error(t, add("school_holiday", school, "5469"), "the scope is gone")

	require.NoError(t, schoolHolidayCostCenterUp(ctx, db))
	require.NoError(t, add("school_holiday", school, "5469"))
	assert.Equal(t, []string{"5467", "5469"}, codes())
}
