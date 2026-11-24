package postgres

import (
	"context"
	"database/sql"
	"fmt"
	"testing"

	"github.com/stretchr/testify/require"

	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// A kind locked for its update keeps a proof or a mapping that references it
// free to be written: their foreign key takes FOR KEY SHARE on the kind, and
// the update changes no key column. A FOR UPDATE lock would hold every
// proof of that kind until the update commits.
func TestLockProofTypeLetsReferencesThrough(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	organization := testpkg.CreateTestOrganization(t, db, &testpkg.Organization{
		Name: "Nachweis-Sperre", Slug: fmt.Sprintf("proof-lock-%d", testpkg.UniqueTestTenantID(t)),
	}).ID
	var kind int64
	require.NoError(t, db.NewRaw(`INSERT INTO workforce.staff_proof_types (organization_id, name, reminder_lead_weeks, sort_order)
		VALUES (?, 'Belehrung', 4, 0) RETURNING id`, organization).Scan(context.Background(), &kind))

	ctx := testpkg.ContextWithTenantRuntime(context.Background(), testpkg.TenantRuntime(t, db))
	require.NoError(t, testpkg.WithinTraeger(ctx, organization, func(ctx context.Context) error {
		locked, err := NewTraegerStaffStore().LockProofType(ctx, organization, kind)
		require.NoError(t, err)
		require.Equal(t, kind, locked.ID)

		// The foreign key check of a proof inserted beside the update.
		reference, err := db.BeginTx(context.Background(), &sql.TxOptions{})
		require.NoError(t, err)
		defer func() { _ = reference.Rollback() }()
		_, err = reference.ExecContext(context.Background(), `SET LOCAL lock_timeout = '300ms'`)
		require.NoError(t, err)
		var found int
		require.NoError(t, reference.NewRaw(`SELECT 1 FROM workforce.staff_proof_types WHERE id = ? FOR KEY SHARE`, kind).
			Scan(context.Background(), &found), "a reference waits for the locked kind")
		return nil
	}))
}
