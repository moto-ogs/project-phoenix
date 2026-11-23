package behavior_test

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/moto-ogs/project-phoenix/api"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

// Two schools run the bulk invitation at the same moment for a guardian who
// has a child at each and whose access to both schools is inactive (#7760).
// Each run restores its school's mapping, which needs the account row FOR NO
// KEY UPDATE. Both runs take that lock up front, ascending, before anything
// else touches the account; they wait for each other instead of each holding
// a weaker lock and upgrading it into a deadlock. A blocker holds the account
// until both runs wait at it, so they start the account step together. Both
// commit, both mappings are active, no 40P01. The mixed case pairs a run with
// the care notice and a plain invitation: both take the same lock.
func TestBulkInviteToStudents_TwoSchoolsShareAnAccountWithoutDeadlock(t *testing.T) {
	t.Parallel()

	for name, notify := range map[string][2]bool{
		"both with the care notice":             {true, true},
		"one with, one without the care notice": {true, false},
	} {
		t.Run(name, func(t *testing.T) {
			env := setupGuardianInvitationTest(t, func(_ *bun.DB, cfg *api.GuardianInvitationTestConfig) { cfg.Outbox = api.NewCapturingOutbox() })
			ctx := testpkg.Ctx(t)
			schoolA := testpkg.Tenant(t)
			schoolB, _ := testpkg.CreateTestTenant(t, env.db)
			account := testpkg.CreateTestAccount(t, env.db, fmt.Sprintf("zwei-schulen-%d", testpkg.UniqueSuffix()))
			creator := env.inviterAccountID(t)

			requests := map[int64]identityaccess.BulkInviteRequest{}
			for i, school := range []int64{schoolA, schoolB} {
				student := testpkg.CreateTestStudentForTenant(t, env.db, school, "Kind", fmt.Sprintf("Zwei%d", i), "2a")
				profile := testpkg.CreateTestGuardianProfileForTenant(t, env.db, school, "Eva", "Zwei", "zwei-schulen")
				testpkg.CreateTestStudentGuardianLinkForTenant(t, env.db, school, student.ID, profile.ID, guardianRoleLegalGuardian)
				_, err := env.db.NewRaw(`UPDATE users.guardian_profiles SET account_id = ?, has_account = TRUE WHERE id = ?`, account.ID, profile.ID).Exec(ctx)
				require.NoError(t, err)
				_, err = env.db.NewRaw(`UPDATE auth.guardian_student_access a SET account_id = ?
					FROM users.student_guardian_relationships r WHERE r.id = a.relationship_id AND r.guardian_profile_id = ?`, account.ID, profile.ID).Exec(ctx)
				require.NoError(t, err)
				_, err = env.db.NewRaw(`INSERT INTO auth.account_tenants (account_id, tenant_id, status, deactivated_at)
					VALUES (?, ?, 'inactive', NOW()) ON CONFLICT (account_id, tenant_id) DO UPDATE SET status = 'inactive', deactivated_at = NOW()`,
					account.ID, school).Exec(ctx)
				require.NoError(t, err)
				requests[school] = identityaccess.BulkInviteRequest{StudentIDs: []int64{student.ID}, CreatedBy: creator, NotifyActive: notify[i]}
			}

			blocker, err := env.db.BeginTx(ctx, nil)
			require.NoError(t, err)
			defer func() { _ = blocker.Rollback() }()
			_, err = blocker.ExecContext(ctx, `SELECT id FROM auth.accounts WHERE id = ? FOR UPDATE`, account.ID)
			require.NoError(t, err)

			errs := make(chan error, 2)
			for school, req := range requests {
				go func() {
					_, runErr := env.service.BulkInviteToStudents(testpkg.WithTestTenantRuntime(t, testpkg.TenantContext(school)), req)
					errs <- runErr
				}()
			}
			waitForAccountWaiters(t, env.db, account.ID, 2)
			require.NoError(t, blocker.Rollback())

			for range requests {
				select {
				case runErr := <-errs:
					assert.NoError(t, runErr, "both runs commit; neither is the victim of a deadlock")
				case <-time.After(30 * time.Second):
					t.Fatal("a run did not finish")
				}
			}
			var active int
			require.NoError(t, env.db.NewRaw(`SELECT count(*) FROM auth.account_tenants
				WHERE account_id = ? AND tenant_id IN (?, ?) AND status = 'active'`, account.ID, schoolA, schoolB).Scan(ctx, &active))
			assert.Equal(t, 2, active, "both runs restored their school's mapping")
		})
	}
}

// waitForAccountWaiters waits until n sessions wait for a lock on the
// account's row, read from the lock table rather than a fixed sleep.
func waitForAccountWaiters(t *testing.T, db *bun.DB, accountID int64, n int) {
	t.Helper()
	deadline := time.Now().Add(15 * time.Second)
	for {
		var waiting int
		require.NoError(t, db.NewRaw(`SELECT count(*) FROM pg_stat_activity
			WHERE wait_event_type = 'Lock' AND query LIKE '%auth.accounts%' AND query LIKE '%FOR NO KEY UPDATE%' AND query LIKE ?`,
			fmt.Sprintf("%%%d%%", accountID)).Scan(context.Background(), &waiting))
		if waiting >= n {
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("only %d of %d runs reached the account lock", waiting, n)
		}
		time.Sleep(10 * time.Millisecond)
	}
}
