package postgres

import (
	"context"
	"strings"
	"testing"

	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

// The care notice of the bulk invitation (#7760) decides on the account,
// its membership of the school's parents portal and the access row. A run
// that mails pins all of them until it commits: an operator who revokes the
// account's access or deactivates the account in that window waits, and a
// parent_portal.access change waits as well. The account is held FOR NO KEY
// UPDATE, the mode the run's own grant needs later: a second run that shares
// the account waits instead of deadlocking on an upgrade, while the parent
// guards' KEY SHARE holds still pass. These cases fail if a lock clause is
// dropped or weakened.
func TestGuardianCareNoticePinsTheDecision(t *testing.T) {
	t.Parallel()

	db := testpkg.SetupTestDB(t)
	ctx := testpkg.Ctx(t)
	chain := testpkg.CreateTestParentGuardianChain(t, db)
	store := lockingStore(db, chain.TenantID)
	var relationshipID int64
	require.NoError(t, db.NewRaw(`SELECT id FROM users.student_guardian_relationships WHERE guardian_profile_id = ? AND student_id = ?`,
		chain.GuardianProfileID, chain.StudentID).Scan(ctx, &relationshipID))

	decide := func(t *testing.T, tx bun.Tx) {
		t.Helper()
		txCtx := context.WithValue(ctx, heldTxKey{}, tx)
		require.NoError(t, store.LockBulkInviteAccounts(txCtx, []int64{chain.AccountID}, nil))
		require.NoError(t, store.LockGuardianNoticeMemberships(txCtx, []int64{chain.AccountID}))
		states, err := store.ListGuardianCareNotices(txCtx, []int64{relationshipID}, true)
		require.NoError(t, err)
		state := states[relationshipID]
		require.True(t, state.AccountActive && state.PortalMember && state.PortalAccess, "the fixture is eligible: %+v", state)
		assert.Equal(t, chain.Email, state.Email)
	}
	hold := func(t *testing.T) {
		t.Helper()
		holder, err := db.BeginTx(ctx, nil)
		require.NoError(t, err)
		t.Cleanup(func() { _ = holder.Rollback() })
		decide(t, holder)
	}

	for name, write := range map[string]string{
		"the account cannot be deactivated":        `UPDATE auth.accounts SET active = FALSE WHERE id = ?`,
		"the school mapping cannot be revoked":     `UPDATE auth.account_tenants SET status = 'inactive' WHERE account_id = ?`,
		"the guardian role cannot be removed":      `DELETE FROM auth.account_roles WHERE account_id = ?`,
		"parent_portal.access cannot be withdrawn": `UPDATE auth.guardian_student_access SET permissions = '{}'::jsonb WHERE account_id = ?`,
	} {
		t.Run(name, func(t *testing.T) {
			hold(t)
			err := runWithLockTimeout(ctx, db, "200ms", func(tx bun.Tx) error {
				_, execErr := tx.ExecContext(ctx, write, chain.AccountID)
				return execErr
			})
			require.Error(t, err, "the write must wait for the run that decided on the row")
			assert.True(t, isLockTimeoutError(err), "expected lock_timeout error, got: %v", err)
		})
	}

	t.Run("a second run waits instead of upgrading a shared hold", func(t *testing.T) {
		hold(t)
		err := runWithLockTimeout(ctx, db, "200ms", func(tx bun.Tx) error {
			return store.LockBulkInviteAccounts(context.WithValue(ctx, heldTxKey{}, tx), []int64{chain.AccountID}, nil)
		})
		require.Error(t, err)
		assert.True(t, isLockTimeoutError(err), "expected lock_timeout error, got: %v", err)
	})

	t.Run("an account found only by its address is locked too", func(t *testing.T) {
		holder, err := db.BeginTx(ctx, nil)
		require.NoError(t, err)
		t.Cleanup(func() { _ = holder.Rollback() })
		require.NoError(t, store.LockBulkInviteAccounts(context.WithValue(ctx, heldTxKey{}, holder), nil, []string{strings.ToLower(chain.Email)}))
		err = runWithLockTimeout(ctx, db, "200ms", func(tx bun.Tx) error {
			_, execErr := tx.ExecContext(ctx, `SELECT id FROM auth.accounts WHERE id = ? FOR UPDATE`, chain.AccountID)
			return execErr
		})
		require.Error(t, err, "a parent's invitation that locks the account waits for the run")
		assert.True(t, isLockTimeoutError(err), "expected lock_timeout error, got: %v", err)
	})

	t.Run("a parent guard's key share hold still passes", func(t *testing.T) {
		hold(t)
		err := runWithLockTimeout(ctx, db, "500ms", func(tx bun.Tx) error {
			_, lockErr := store.LockLiveGuardianAccount(context.WithValue(ctx, heldTxKey{}, tx), chain.AccountID)
			return lockErr
		})
		assert.NoError(t, err, "FOR KEY SHARE is compatible with FOR NO KEY UPDATE")
	})
}
