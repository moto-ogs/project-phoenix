package postgres

import (
	"context"
	"database/sql"
	"testing"

	"github.com/stretchr/testify/require"

	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// The categories a shift type edit links stay referenceable while the edit
// holds them: a group naming the category takes FOR KEY SHARE in its FK
// check, and the link write changes no key column.
func TestLockShiftTypeLinkCategoriesLetsReferencesThrough(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	ctx := testpkg.Ctx(t)
	category := testpkg.CreateTestActivityCategory(t, db, "Verknüpfte Kategorie")
	store := New(DatabaseRuntime(db))
	require.NoError(t, testpkg.WithinTenantContext(t, ctx, db, testpkg.Tenant(t), func(ctx context.Context) error {
		locked, _, err := store.LockShiftTypeLinkCategories(ctx, 0, []int64{category.ID})
		require.NoError(t, err)
		require.Len(t, locked, 1)

		reference, err := db.BeginTx(ctx, &sql.TxOptions{})
		require.NoError(t, err)
		defer func() { _ = reference.Rollback() }()
		_, err = reference.ExecContext(ctx, `SET LOCAL lock_timeout = '300ms'`)
		require.NoError(t, err)
		var found int
		require.NoError(t, reference.NewRaw(`SELECT 1 FROM activities.categories WHERE id = ? FOR KEY SHARE`, category.ID).
			Scan(ctx, &found), "a reference waits for the locked category")
		return nil
	}))
}
