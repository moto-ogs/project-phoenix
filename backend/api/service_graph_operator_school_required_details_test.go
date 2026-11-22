package api

import (
	"context"
	"testing"

	"github.com/moto-ogs/project-phoenix/modules/organizationtenancy"
	configModels "github.com/moto-ogs/project-phoenix/modules/settings/records"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	querybudgets "github.com/moto-ogs/project-phoenix/test/query-budgets"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestOperatorSchoolRequiredDetails marks the schools whose replies bounce
// (#7174) over the real owners: a provisioned school has a contact address, a
// school from before #2872 has none, and a reply setting alone is enough. The
// statement count stays flat in the number of schools: one school read and
// one settings batch read.
func TestOperatorSchoolRequiredDetails(t *testing.T) {
	t.Parallel()
	// The counter attaches to this database, so the scenario owns its own
	// clone and cannot see statements from a parallel package.
	db := testpkg.SetupIsolatedTestDB(t)
	provisioning := buildOperatorProvisioning(t, db)
	operatorID := testpkg.CreateTestOperator(t, db).ID
	_, provisioned := provisionTestSchool(t, db, provisioning, operatorID, "required")

	legacy := testpkg.UniqueTestTenantID(t)
	testpkg.EnsureTestTenant(t, db, legacy)
	repliesBySetting := testpkg.UniqueTestTenantID(t)
	testpkg.EnsureTestTenant(t, db, repliesBySetting)
	_, err := db.ExecContext(context.Background(), `UPDATE platform.schools SET email = NULL WHERE id IN (?, ?)`, legacy, repliesBySetting)
	require.NoError(t, err)
	testpkg.SetTestTenantSetting(t, db, repliesBySetting, configModels.KeyEmailReplyToAddress, `"eltern@schule.example"`)

	counter := testpkg.CaptureQueries(t, db)
	ctx := testpkg.WithTenantRuntime(t, context.Background(), db)
	list := func() (map[int64]organizationtenancy.SchoolRequiredDetails, []string) {
		t.Helper()
		byID := map[int64]organizationtenancy.SchoolRequiredDetails{}
		counter.Reset()
		details, err := provisioning.RequiredDetails.ListSchoolRequiredDetails(ctx)
		require.NoError(t, err)
		statements := counter.Queries()
		for _, detail := range details {
			byID[detail.SchoolID.Int64()] = detail
		}
		return byID, statements
	}

	byID, before := list()
	querybudgets.AssertQueryBudget(t, "services.operator.school_required_details", counter.Measurement(before))
	require.Contains(t, byID, provisioned)
	assert.False(t, byID[provisioned].ReplyAddressMissing, "the contact address answers")
	require.Contains(t, byID, legacy)
	assert.True(t, byID[legacy].ReplyAddressMissing, "neither setting nor contact address answers")
	require.Contains(t, byID, repliesBySetting)
	assert.False(t, byID[repliesBySetting].ReplyAddressMissing, "the reply setting answers on its own")

	for range 3 {
		testpkg.EnsureTestTenant(t, db, testpkg.UniqueTestTenantID(t))
	}
	_, after := list()
	querybudgets.AssertQueryBudget(t, "services.operator.school_required_details", counter.Measurement(after))
	require.Len(t, after, len(before), "the required details stay flat in the number of schools")
}
