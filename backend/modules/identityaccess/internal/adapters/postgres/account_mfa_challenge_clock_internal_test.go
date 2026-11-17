package postgres

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/modules/identityaccess/internal/application"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess/internal/domain"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// TestMFAChallengeStampsAndExpiresOnTheOwnerClock pins the owner's clock to
// a night of the clock change, years past the database clock (#7295,
// ADR 0281). A challenge written without its own created_at takes the
// owner's instant, so the send rate limit counts it; a challenge expired on
// the owner's clock is refused although the database clock still sees it
// open, and one valid on the owner's clock is accepted.
func TestMFAChallengeStampsAndExpiresOnTheOwnerClock(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	ctx := testpkg.Ctx(t)
	pinned := calendar.NewDate(2030, time.March, 31).BerlinMidnight().Add(150 * time.Minute)
	records := application.NewAccountMFACommands(NewAccountMFARecords(NewStore(db, func() time.Time { return pinned })), adminTxRuntime{t: t, db: db})
	account := testpkg.CreateTestAccount(t, db, "mfa-owner-clock")

	valid, err := records.CreateChallenge(ctx, domain.AccountMFAChallenge{
		AccountID: account.ID, TenantID: testpkg.Tenant(t), Scope: "tenant",
		CodeHash: "valid-hash", ExpiresAt: pinned.Add(time.Minute),
	})
	require.NoError(t, err)
	require.WithinDuration(t, pinned, valid.CreatedAt, time.Second, "created_at follows the owner's clock")

	sent, err := records.CountChallengesSince(ctx, account.ID, pinned.Add(-domain.MFAEmailRateLimitWindow))
	require.NoError(t, err)
	require.Equal(t, 1, sent, "the send rate limit counts a challenge created on the owner's clock")

	expired, err := records.CreateChallenge(ctx, domain.AccountMFAChallenge{
		AccountID: account.ID, TenantID: testpkg.Tenant(t), Scope: "tenant",
		CodeHash: "expired-hash", ExpiresAt: pinned.Add(-time.Minute),
	})
	require.NoError(t, err)
	_, found, err := records.FindActiveChallengeForAccount(ctx, expired.ID, account.ID)
	require.NoError(t, err)
	require.False(t, found, "a challenge expired on the owner's clock is refused")
	_, found, err = records.FindActiveChallengeForAccount(ctx, valid.ID, account.ID)
	require.NoError(t, err)
	require.True(t, found, "a challenge valid on the owner's clock is accepted")
}
