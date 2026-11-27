package integration

import (
	"context"
	"errors"
	"fmt"
	"testing"

	"github.com/moto-ogs/project-phoenix/api"
	importModels "github.com/moto-ogs/project-phoenix/modules/dataimport"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestClassListImportConvertsEachCommittedBatch(t *testing.T) {
	t.Parallel()
	for _, rowPath := range []bool{false, true} {
		t.Run(fmt.Sprintf("row_path_%t", rowPath), func(t *testing.T) {
			testpkg.OwnTenant(t)
			db := testpkg.SetupIsolatedTestDB(t)
			var module api.ImportTestModule
			failConversion := false
			options := api.ImportTestOptions{RowPathOnly: rowPath, ClassListConversion: func(ctx context.Context, actor int64) error {
				if failConversion {
					return errors.New("conversion refused")
				}
				return module.ClassListConversion.ConvertClassListEntries(ctx, actor)
			}}
			var err error
			module, _, _, err = api.NewImportTestModuleWithOwners(testpkg.NewDatabase(t, db), testpkg.TenantRuntime(t, db), options)
			require.NoError(t, err)
			actor := testpkg.CreateTestAccount(t, db, "batch-conversion@example.com")
			_, err = db.ExecContext(testpkg.Ctx(t), `ALTER TABLE users.class_list_entries ADD CONSTRAINT refuse_conversion_batch CHECK (first_name <> 'Refused')`)
			require.NoError(t, err)
			rows := make([]importModels.ClassListEntryImportRow, 101)
			for i := range rows {
				rows[i] = importModels.ClassListEntryImportRow{FirstName: fmt.Sprintf("Kind%d", i), LastName: "Import", SchoolClass: "2a"}
			}
			rows[100].FirstName = "Refused"
			request := importModels.ImportRequest[importModels.ClassListEntryImportRow]{Rows: rows, Mode: importModels.ImportModeCreate, UserID: actor.ID}
			audit := importModels.BatchAudit{EntityType: "class_list_entries", Filename: "conversion.csv", AccountID: actor.ID}
			result, err := module.ClassListImport.ImportBatches(testpkg.Ctx(t), request, audit)
			require.Error(t, err)
			require.Equal(t, 100, result.CreatedCount)
			count := func(table string) int {
				t.Helper()
				var n int
				require.NoError(t, db.NewSelect().TableExpr(table).ColumnExpr("count(*)").Where("tenant_id = ?", testpkg.Tenant(t)).Scan(testpkg.Ctx(t), &n))
				return n
			}
			assert.Zero(t, count("users.class_list_entries"), "committed batches have already been converted even when a later batch fails")
			assert.Equal(t, 100, count("users.student_school_memberships"))
			_, err = db.ExecContext(testpkg.Ctx(t), `ALTER TABLE users.class_list_entries DROP CONSTRAINT refuse_conversion_batch`)
			require.NoError(t, err)
			failConversion = true
			result, err = module.ClassListImport.ImportBatches(testpkg.Ctx(t), request, audit)
			require.Error(t, err)
			assert.Equal(t, 100, result.CreatedCount, "conversion failure must roll back its batch and receipt, retaining earlier progress")
			assert.Zero(t, count("users.class_list_entries"))
			assert.Equal(t, 100, count("users.student_school_memberships"))
			failConversion = false
			result, err = module.ClassListImport.ImportBatches(testpkg.Ctx(t), request, audit)
			require.NoError(t, err)
			assert.Equal(t, 101, result.CreatedCount)
			assert.Zero(t, count("users.class_list_entries"))
			assert.Equal(t, 101, count("users.student_school_memberships"))
		})
	}
}
