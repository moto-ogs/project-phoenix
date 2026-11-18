package behavior_test

import (
	"context"
	"log/slog"
	"testing"
	"time"

	"github.com/moto-ogs/project-phoenix/api"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/require"
)

// The orphan push cleanup decides on the session clock of Identity & Access,
// the clock that stamps the session expiry, not on the database clock. Each
// direction runs on its own clone: the sweep is database-global.
func TestOrphanPushCleanupDecidesOnTheSessionClockWhenGoIsAhead(t *testing.T) {
	t.Parallel()
	assertOrphanPushCleanupOnSessionClock(t, 40*24*time.Hour)
}

func TestOrphanPushCleanupDecidesOnTheSessionClockWhenGoIsBehind(t *testing.T) {
	t.Parallel()
	assertOrphanPushCleanupOnSessionClock(t, -40*24*time.Hour)
}

// assertOrphanPushCleanupOnSessionClock pins the Identity & Access clock
// offset days away from the database clock and stamps every session expiry on
// it: a live session keeps its subscription, an expired, revoked or
// wrong-school one loses it.
func assertOrphanPushCleanupOnSessionClock(t *testing.T, offset time.Duration) {
	t.Helper()
	testpkg.SetupIsolatedTestDB(t)
	db := testpkg.SetupTestDB(t)
	var databaseNow time.Time
	require.NoError(t, db.NewSelect().ColumnExpr("now()").Scan(context.Background(), &databaseNow))
	sessionNow := databaseNow.Add(offset)
	module, err := api.NewTestIdentityAccessWithConfig(testpkg.NewDatabase(t, db), slog.Default(), authTestFactoryConfig(false),
		func() time.Time { return sessionNow })
	require.NoError(t, err)
	service := newFixtureAuthService(t, db, module)

	tenantID, _ := testpkg.CreateTestTenant(t, db)
	otherTenantID, _ := testpkg.CreateTestTenant(t, db)
	ctx := testpkg.TenantContext(tenantID)
	email, username := uniqueTestCredentials("orphan-push-clock")
	account, err := service.Register(ctx, email, username, testPassword, nil, 0)
	require.NoError(t, err)
	testpkg.EnsureAccountTenant(t, db, account.ID, tenantID)

	insertSession := func(family, portalScope string, expiry time.Time) {
		t.Helper()
		session := &testpkg.TokenFixture{
			AccountID: account.ID, Token: sha256Hex(uniqueTestName("orphan-push-clock")),
			Expiry: expiry, FamilyID: family, PortalScope: portalScope,
		}
		session.TenantID = tenantID
		_, insertErr := db.NewInsert().Model(session).ModelTableExpr("auth.tokens").Exec(context.Background())
		require.NoError(t, insertErr)
	}
	liveFamily, expiredFamily := uniqueTestName("live-family"), uniqueTestName("expired-family")
	insertSession(liveFamily, "tenant", sessionNow.Add(time.Hour))
	insertSession(expiredFamily, "tenant", sessionNow.Add(-time.Hour))
	insertSession("", "unknown", sessionNow.Add(time.Hour))

	const (
		live      = "https://fcm.googleapis.com/clock-live-family"
		expired   = "https://fcm.googleapis.com/clock-expired-family"
		revoked   = "https://fcm.googleapis.com/clock-revoked-family"
		legacy    = "https://fcm.googleapis.com/clock-legacy-parent"
		elsewhere = "https://fcm.googleapis.com/clock-unbound-other-school"
	)
	insertStaffPush(t, db, account.ID, tenantID, live, liveFamily)
	insertStaffPush(t, db, account.ID, tenantID, expired, expiredFamily)
	insertStaffPush(t, db, account.ID, tenantID, revoked, uniqueTestName("revoked-family"))
	insertParentPush(t, db, account.ID, tenantID, legacy, "")
	// The live sessions belong to the home school; no session backs an
	// unbound staff subscription at the other school.
	insertStaffPush(t, db, account.ID, otherTenantID, elsewhere, "")

	_, err = service.CleanupExpiredTokens(ctx)
	require.NoError(t, err)

	require.Equal(t, 1, countStaffPush(t, db, account.ID, live), "a live session keeps its subscription")
	require.Equal(t, 1, countParentPush(t, db, account.ID, legacy), "a live legacy session keeps the unbound parent subscription")
	require.Equal(t, 0, countStaffPush(t, db, account.ID, expired), "an expired session loses its subscription")
	require.Equal(t, 0, countStaffPush(t, db, account.ID, revoked), "a revoked session loses its subscription")
	require.Equal(t, 0, countStaffPush(t, db, account.ID, elsewhere), "a session at another school backs no unbound staff subscription")
}

func TestOrphanPushCleanupKeepsSubscriptionsOfAnInFlightLogin(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupIsolatedTestDB(t)
	service := setupAuthService(t, db)
	schoolID, _ := testpkg.CreateTestTenant(t, db)
	ctx := testpkg.TenantContext(schoolID)

	makeAccount := func(name string) int64 {
		email, username := uniqueTestCredentials(name)
		account, err := service.Register(ctx, email, username, testPassword, nil, 0)
		require.NoError(t, err)
		testpkg.EnsureAccountTenant(t, db, account.ID, schoolID)
		return account.ID
	}
	signingIn := makeAccount("orphan-push-signing-in")
	orphaned := makeAccount("orphan-push-no-login")
	const loginEndpoint = "https://fcm.googleapis.com/orphan-push-signing-in"
	const orphanEndpoint = "https://fcm.googleapis.com/orphan-push-no-login"
	insertStaffPush(t, db, signingIn, schoolID, loginEndpoint, "")
	insertStaffPush(t, db, orphaned, schoolID, orphanEndpoint, "")

	// Token insertion takes a key-share lock on the account until commit.
	login, err := db.BeginTx(ctx, nil)
	require.NoError(t, err)
	t.Cleanup(func() { _ = login.Rollback() })
	token := &testpkg.TokenFixture{
		AccountID:   signingIn,
		Token:       sha256Hex(uniqueTestName("in-flight-login")),
		Expiry:      time.Now().Add(time.Hour),
		PortalScope: "tenant",
	}
	token.TenantID = schoolID
	_, err = login.NewInsert().Model(token).ModelTableExpr("auth.tokens").Exec(ctx)
	require.NoError(t, err)

	_, err = service.CleanupExpiredTokens(ctx)
	require.NoError(t, err)
	require.Equal(t, 1, countStaffPush(t, db, signingIn, loginEndpoint))
	require.Equal(t, 0, countStaffPush(t, db, orphaned, orphanEndpoint))
	require.NoError(t, login.Commit())

	_, err = service.CleanupExpiredTokens(ctx)
	require.NoError(t, err)
	require.Equal(t, 1, countStaffPush(t, db, signingIn, loginEndpoint))
}
