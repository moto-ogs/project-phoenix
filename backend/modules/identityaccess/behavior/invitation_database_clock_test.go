package behavior_test

import (
	"context"
	"fmt"
	"log/slog"
	"testing"
	"time"

	"github.com/moto-ogs/project-phoenix/api"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

// auth.account_is_unused keeps an account while an unused, unexpired staff
// or guardian invitation names its address, judged against the database's
// statement_timestamp(). So both invitations live on the database clock
// (ADR 0285, Nachtrag). With the Go clock a month off, in either direction,
// a fresh invitation protects its address for exactly its lifetime on the
// database clock: not past it, and not shorter.
func TestStaffInvitationProtectsTheAccountOnTheDatabaseClockWithGoAhead(t *testing.T) {
	t.Parallel()
	assertStaffInvitationOnTheDatabaseClock(t, 31*24*time.Hour)
}

func TestStaffInvitationProtectsTheAccountOnTheDatabaseClockWithGoBehind(t *testing.T) {
	t.Parallel()
	assertStaffInvitationOnTheDatabaseClock(t, -31*24*time.Hour)
}

func TestGuardianInvitationProtectsTheAccountOnTheDatabaseClockWithGoAhead(t *testing.T) {
	t.Parallel()
	assertGuardianInvitationOnTheDatabaseClock(t, 31*24*time.Hour)
}

func TestGuardianInvitationProtectsTheAccountOnTheDatabaseClockWithGoBehind(t *testing.T) {
	t.Parallel()
	assertGuardianInvitationOnTheDatabaseClock(t, -31*24*time.Hour)
}

// clockOffsetModule composes Identity & Access with its clock offset from
// the database clock, the way the root binds it.
func clockOffsetModule(t *testing.T, db *bun.DB, offset time.Duration) (identityaccess.Owner, func() time.Time, time.Time) {
	t.Helper()
	databaseNow := testpkg.DatabaseNow(t, db)
	goClock := func() time.Time { return databaseNow.Add(offset) }
	module, err := api.NewTestIdentityAccessWithConfig(testpkg.NewDatabase(t, db), slog.Default(), authTestFactoryConfig(false), goClock)
	require.NoError(t, err)
	return module, goClock, databaseNow
}

// unusedAccount is an account without school, contact or request: only an
// invitation to its address keeps it from the erasure.
func unusedAccount(t *testing.T, db *bun.DB, email string) int64 {
	t.Helper()
	var id int64
	require.NoError(t, db.NewRaw(`INSERT INTO auth.accounts (email, active) VALUES (?, TRUE) RETURNING id`, email).Scan(t.Context(), &id))
	t.Cleanup(func() {
		_, _ = db.ExecContext(context.Background(), `DELETE FROM auth.accounts WHERE id = ?`, id)
	})
	require.True(t, accountIsUnused(t, db, id), "nothing but the invitation names the account")
	return id
}

func accountIsUnused(t *testing.T, db *bun.DB, accountID int64) bool {
	t.Helper()
	var unused bool
	require.NoError(t, db.NewRaw(`SELECT auth.account_is_unused(id, email) FROM auth.accounts WHERE id = ?`, accountID).Scan(t.Context(), &unused))
	return unused
}

// invitationLifetime is the lifetime of both links in the test composition:
// 48 hours, the default of the staff link and of the school setting for the
// guardian link.
const invitationLifetime = 48 * time.Hour

// assertLifetimeOnTheDatabaseClock checks that the invitation keeps the
// account, runs for its lifetime from the database time it was issued at,
// and leaves the account to the erasure once that lifetime has passed. The
// passing of time is the invitation's expiry moved back by its lifetime.
func assertLifetimeOnTheDatabaseClock(t *testing.T, db *bun.DB, table string, invitationID, accountID int64, issuedAt time.Time) {
	t.Helper()
	assert.False(t, accountIsUnused(t, db, accountID), "a running invitation keeps the account")
	var expiresAt time.Time
	require.NoError(t, db.NewRaw(`SELECT expires_at FROM `+table+` WHERE id = ?`, invitationID).Scan(t.Context(), &expiresAt))
	assert.WithinDuration(t, issuedAt.Add(invitationLifetime), expiresAt, time.Minute, "the lifetime counts from the database clock")

	_, err := db.ExecContext(t.Context(), `UPDATE `+table+` SET expires_at = expires_at - ?::interval WHERE id = ?`,
		fmt.Sprintf("%d seconds", int64((invitationLifetime+time.Minute)/time.Second)), invitationID)
	require.NoError(t, err)
	assert.True(t, accountIsUnused(t, db, accountID), "after its lifetime the invitation keeps the account no longer")
}

func assertStaffInvitationOnTheDatabaseClock(t *testing.T, offset time.Duration) {
	t.Helper()
	db := testpkg.SetupTestDB(t)
	module, goClock, databaseNow := clockOffsetModule(t, db, offset)
	ctx := testpkg.Ctx(t)
	address := inviteeAddress("clock-staff")
	accountID := unusedAccount(t, db, address)
	role := testpkg.CreateTestRole(t, db, "clock-staff")
	creator := testpkg.CreateTestAccount(t, db, "clock-staff-creator")

	invitation, err := module.CreateSchoolInvitation(ctx, identityaccess.SchoolInvitationRequest{
		Email: address, RoleID: role.ID, CreatedBy: creator.ID, ActorPermissions: []string{usersManagePermission},
	})
	require.NoError(t, err)

	pending, err := module.ListPendingSchoolInvitations(ctx)
	require.NoError(t, err)
	assert.Contains(t, invitationIDs(pending), invitation.ID, "the school's list shows the invitation open")
	_, err = module.ValidateSchoolInvitation(context.Background(), invitation.Token)
	require.NoError(t, err, "the link opens")

	// The mail's renderer drops a link expired on the composition's clock.
	var mailExpiresAt time.Time
	require.NoError(t, db.NewRaw(`SELECT (payload->>'ExpiresAt')::timestamptz FROM platform.email_outbox
		WHERE related_entity_type = 'invitation' AND related_entity_id = ?`, invitation.ID).Scan(t.Context(), &mailExpiresAt))

	assertLifetimeOnTheDatabaseClock(t, db, "auth.invitation_tokens", invitation.ID, accountID, databaseNow)
	assert.WithinDuration(t, goClock().Add(invitationLifetime), mailExpiresAt, time.Minute, "the mail carries the expiry on the composition's clock")
}

func invitationIDs(invitations []identityaccess.SchoolInvitation) []int64 {
	ids := make([]int64, 0, len(invitations))
	for _, invitation := range invitations {
		ids = append(ids, invitation.ID)
	}
	return ids
}

func assertGuardianInvitationOnTheDatabaseClock(t *testing.T, offset time.Duration) {
	t.Helper()
	db := testpkg.SetupTestDB(t)
	module, _, databaseNow := clockOffsetModule(t, db, offset)
	ctx := testpkg.Ctx(t)
	profile := testpkg.CreateTestGuardianProfile(t, db, "clock-guardian")
	accountID := unusedAccount(t, db, *profile.Email)
	creator := testpkg.CreateTestAccount(t, db, "clock-guardian-creator")

	invitation, err := module.CreateGuardianInvitation(ctx, identityaccess.GuardianInvitationRequest{GuardianProfileID: profile.ID, CreatedBy: creator.ID})
	require.NoError(t, err)

	open, err := module.ListOpenGuardianInvitations(ctx, []int64{profile.ID})
	require.NoError(t, err)
	require.Len(t, open, 1, "the guardian list shows the invitation open")
	assert.False(t, open[0].Expired)
	_, err = module.ValidateGuardianInvitation(context.Background(), invitation.Token)
	require.NoError(t, err, "the link opens")

	var expiryHours int
	require.NoError(t, db.NewRaw(`SELECT (payload->>'expiry_hours')::int FROM platform.email_outbox
		WHERE related_entity_type = ? AND related_entity_id = ?`, identityaccess.MailRelatedGuardianInvitation, invitation.ID).Scan(t.Context(), &expiryHours))

	assertLifetimeOnTheDatabaseClock(t, db, "auth.guardian_invitations", invitation.ID, accountID, databaseNow)
	assert.Equal(t, int(invitationLifetime/time.Hour), expiryHours, "the mail states the lifetime counted on the database clock")

	open, err = module.ListOpenGuardianInvitations(ctx, []int64{profile.ID})
	require.NoError(t, err)
	assert.Empty(t, open, "an expired invitation is no longer open")
}

// An invitation that expires while another transaction holds its row lock
// is refused once the lock is free (ADR 0285, Nachtrag): the acceptance
// judges the expiry at the database time after its lock wait.
func TestStaffAndGuardianInvitationExpiredDuringTheLockWaitIsRefused(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	module := setupAuthFactory(t, db)
	creator := testpkg.CreateTestAccount(t, db, "invitation-lock-expiry")

	t.Run("staff", func(t *testing.T) {
		t.Parallel()
		ctx := testpkg.Ctx(t)
		role := testpkg.CreateTestRole(t, db, "lock-staff")
		invitation, err := module.CreateSchoolInvitation(ctx, identityaccess.SchoolInvitationRequest{
			Email: inviteeAddress("lock-staff"), RoleID: role.ID, CreatedBy: creator.ID, ActorPermissions: []string{usersManagePermission},
		})
		require.NoError(t, err)
		err = expireInvitationWhileLocked(t, db, "auth.invitation_tokens", invitation.ID, func() error {
			_, err := module.AcceptSchoolInvitation(context.Background(), invitation.Token, identityaccess.InvitationRegistration{
				FirstName: "Lock", LastName: "Wait", Password: invitationPassword, ConfirmPassword: invitationPassword,
			})
			return err
		})
		require.ErrorIs(t, err, identityaccess.ErrInvitationExpired)
		assert.Nil(t, (newInvitationEnv(t, db)).storedInvitation(t, invitation.ID).UsedAt, "the expired invitation stays unspent")
	})

	t.Run("guardian", func(t *testing.T) {
		t.Parallel()
		ctx := testpkg.Ctx(t)
		profile := testpkg.CreateTestGuardianProfile(t, db, "lock-guardian")
		invitation, err := module.CreateGuardianInvitation(ctx, identityaccess.GuardianInvitationRequest{GuardianProfileID: profile.ID, CreatedBy: creator.ID})
		require.NoError(t, err)
		err = expireInvitationWhileLocked(t, db, "auth.guardian_invitations", invitation.ID, func() error {
			_, err := module.AcceptGuardianInvitation(context.Background(), invitation.Token, identityaccess.GuardianRegistration{
				Password: strongTestPassword, ConfirmPassword: strongTestPassword,
			})
			return err
		})
		require.ErrorIs(t, err, identityaccess.ErrInvitationExpired)
		assert.Nil(t, testpkg.GuardianInvitationByID(t, db, invitation.ID).AcceptedAt, "the expired invitation stays unaccepted")
	})
}

// expireInvitationWhileLocked holds the invitation's row lock in another
// transaction until waiter's statement waits for it, then lets the
// invitation expire on the database clock and commits. It returns waiter's
// result.
func expireInvitationWhileLocked(t *testing.T, db *bun.DB, table string, invitationID int64, waiter func() error) error {
	t.Helper()
	ctx := context.Background()
	holder, err := db.BeginTx(ctx, nil)
	require.NoError(t, err)
	defer func() { _ = holder.Rollback() }()
	var holderPID int64
	require.NoError(t, holder.QueryRowContext(ctx, `SELECT pg_backend_pid() FROM `+table+` WHERE id = ? FOR UPDATE`, invitationID).Scan(&holderPID))

	result := make(chan error, 1)
	go func() { result <- waiter() }()
	deadline := time.Now().Add(10 * time.Second)
	for {
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
	_, err = holder.ExecContext(ctx, `UPDATE `+table+` SET expires_at = clock_timestamp() WHERE id = ?`, invitationID)
	require.NoError(t, err)
	require.NoError(t, holder.Commit())
	return <-result
}
