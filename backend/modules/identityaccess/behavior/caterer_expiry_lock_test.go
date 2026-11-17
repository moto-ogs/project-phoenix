package behavior_test

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/identityaccess"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

// An invitation that expires while another transaction holds its row lock
// is refused once the lock is free (ADR 0285): its expiry is judged at the
// database time after the lock wait, not at the start of the waiting
// statement, for the preview and for both ways to accept.
func TestCatererInvitationExpiredDuringTheLockWaitIsRefused(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	caterers := setupAuthFactory(t, db).Caterers()
	staff := testpkg.CreateTestAccount(t, db, "caterer-lock-expiry")
	newRegistration := identityaccess.CatererRegistration{Password: catererPassword, ConfirmPassword: catererPassword}

	t.Run("preview", func(t *testing.T) {
		t.Parallel()
		school, _ := testpkg.CreateTestTenant(t, db)
		email := fmt.Sprintf("kueche-sperre-vorschau-%d@example.com", time.Now().UnixNano())
		token := invite(t, db, caterers, school, staff.ID, email)
		err := expireWhileLocked(t, db, school, email, func() error {
			return inSchool(t, db, school, func(ctx context.Context) error {
				_, err := caterers.PreviewCatererInvitation(ctx, token)
				return err
			})
		})
		require.ErrorIs(t, err, identityaccess.ErrInvitationExpired)
	})

	t.Run("new caterer", func(t *testing.T) {
		t.Parallel()
		school, _ := testpkg.CreateTestTenant(t, db)
		email := fmt.Sprintf("kueche-sperre-neu-%d@example.com", time.Now().UnixNano())
		token := invite(t, db, caterers, school, staff.ID, email)
		err := expireWhileLocked(t, db, school, email, func() error {
			acceptance, err := accept(t, db, caterers, school, token, newRegistration)
			if err == nil {
				forgetCaterer(t, db, acceptance)
			}
			return err
		})
		require.ErrorIs(t, err, identityaccess.ErrInvitationExpired)
	})

	t.Run("existing caterer", func(t *testing.T) {
		t.Parallel()
		first, _ := testpkg.CreateTestTenant(t, db)
		second, _ := testpkg.CreateTestTenant(t, db)
		email := fmt.Sprintf("kueche-sperre-bestand-%d@example.com", time.Now().UnixNano())
		acceptance, err := accept(t, db, caterers, first, invite(t, db, caterers, first, staff.ID, email), newRegistration)
		require.NoError(t, err)
		forgetCaterer(t, db, acceptance)
		token := invite(t, db, caterers, second, staff.ID, email)
		err = expireWhileLocked(t, db, second, email, func() error {
			_, err := accept(t, db, caterers, second, token, identityaccess.CatererRegistration{Password: catererPassword})
			return err
		})
		require.ErrorIs(t, err, identityaccess.ErrInvitationExpired)
	})
}

// expireWhileLocked holds the open invitation's row lock in another
// transaction until waiter's statement waits for it, then lets the
// invitation expire on the database clock and commits. It returns
// waiter's result.
func expireWhileLocked(t *testing.T, db *bun.DB, school int64, email string, waiter func() error) error {
	t.Helper()
	ctx := context.Background()
	holder, err := db.BeginTx(ctx, nil)
	require.NoError(t, err)
	defer func() { _ = holder.Rollback() }()
	var invitationID, holderPID int64
	require.NoError(t, holder.QueryRowContext(ctx, `SELECT id, pg_backend_pid() FROM auth.caterer_invitations
		WHERE tenant_id = ? AND lower(email) = lower(?) AND accepted_at IS NULL AND revoked_at IS NULL FOR UPDATE`, school, email).Scan(&invitationID, &holderPID))

	result := make(chan error, 1)
	go func() { result <- waiter() }()
	deadline := time.Now().Add(10 * time.Second)
	for {
		// Outside the holder's transaction, which keeps one statistics
		// snapshot for its whole length.
		var waiting bool
		require.NoError(t, db.QueryRowContext(ctx,
			`SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE ?::int = ANY (pg_blocking_pids(pid)))`, holderPID).Scan(&waiting))
		if waiting {
			break
		}
		require.True(t, time.Now().Before(deadline), "the waiter never waited for the invitation's lock")
		time.Sleep(5 * time.Millisecond)
	}
	// The waiting statement started before this instant.
	_, err = holder.ExecContext(ctx, `UPDATE auth.caterer_invitations SET expires_at = clock_timestamp() WHERE id = ?`, invitationID)
	require.NoError(t, err)
	require.NoError(t, holder.Commit())
	return <-result
}
