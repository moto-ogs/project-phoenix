package compose

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"

	"github.com/moto-ogs/project-phoenix/modules/peopledirectory"
	"github.com/moto-ogs/project-phoenix/tenant"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// The nightly run deletes a parent contact once it has been without a child
// for longer than the school's window (#4043). It runs only inside the
// school's cleanup transaction, so a deletion never commits without its
// deletion-log entry, and it keeps contacts an open invitation still names.
func TestDeleteExpiredChildlessGuardiansKeepsLinkedRecentAndInvitedContacts(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	module := buildLifecycleModule(t, db)
	ctx := testpkg.Ctx(t)
	school := testpkg.Tenant(t)
	childlessFor := func(guardianID int64, days int) {
		t.Helper()
		_, err := db.ExecContext(context.Background(),
			`UPDATE users.guardian_profiles SET childless_since = NOW() - make_interval(days => ?) WHERE id = ?`, days, guardianID)
		require.NoError(t, err)
	}

	expired := testpkg.CreateTestGuardianProfileForTenant(t, db, school, "Ohne", "Kind", "retention-expired")
	childlessFor(expired.ID, 120)
	invited := testpkg.CreateTestGuardianProfileForTenant(t, db, school, "Neu", "Eingeladen", "retention-invited")
	childlessFor(invited.ID, 120)
	recent := testpkg.CreateTestGuardianProfileForTenant(t, db, school, "Gerade", "Ohne", "retention-recent")
	childlessFor(recent.ID, 10)
	linked := testpkg.CreateTestGuardianProfileForTenant(t, db, school, "Mit", "Kind", "retention-linked")
	student := testpkg.CreateTestStudentForTenant(t, db, school, "Bleibt", "Kind", "1a")
	testpkg.CreateTestStudentGuardianLinkForTenant(t, db, school, student.ID, linked.ID, "primary_guardian")
	childlessFor(linked.ID, 120) // a stale mark: the contact has a child again
	unmarked := testpkg.CreateTestGuardianProfileForTenant(t, db, school, "Noch", "Ohne", "retention-unmarked")
	_, err := db.ExecContext(context.Background(), `UPDATE users.guardian_profiles SET childless_since = NULL WHERE id = ?`, unmarked.ID)
	require.NoError(t, err)
	otherSchool, _ := testpkg.CreateTestTenant(t, db)
	elsewhere := testpkg.CreateTestGuardianProfileForTenant(t, db, otherSchool, "Andere", "Schule", "retention-elsewhere")
	childlessFor(elsewhere.ID, 120)

	var asked []int64
	openInvitations := func(_ context.Context, ids []int64) (map[int64]bool, error) {
		asked = append(asked, ids...)
		return map[int64]bool{invited.ID: true}, nil
	}

	_, err = module.DeleteExpiredChildlessGuardians(ctx, 90, openInvitations)
	require.ErrorContains(t, err, "transaction is required", "outside the cleanup transaction nothing is deleted")
	_, err = module.DeleteExpiredChildlessGuardians(ctx, 0, openInvitations)
	require.ErrorIs(t, err, peopledirectory.ErrGuardianRetentionWindow)
	assert.ElementsMatch(t, []int64{expired.ID, invited.ID, recent.ID, linked.ID, elsewhere.ID}, existingGuardians(t, db, expired.ID, invited.ID, recent.ID, linked.ID, elsewhere.ID))

	require.NoError(t, tenant.WithinCurrentTenant(ctx, func(txCtx context.Context) error {
		deleted, err := module.DeleteExpiredChildlessGuardians(txCtx, 90, openInvitations)
		assert.Equal(t, 1, deleted)
		return err
	}))
	assert.ElementsMatch(t, []int64{expired.ID, invited.ID}, asked, "only the school's expired contacts are checked for invitations")
	assert.ElementsMatch(t, []int64{invited.ID, recent.ID, linked.ID, elsewhere.ID},
		existingGuardians(t, db, expired.ID, invited.ID, recent.ID, linked.ID, elsewhere.ID))
	assert.Nil(t, childlessSince(t, db, linked.ID), "the run clears the mark of a contact with a child")
	assert.NotNil(t, childlessSince(t, db, unmarked.ID), "the run marks a contact without a child and counts from now")
	assert.ElementsMatch(t, []int64{unmarked.ID}, existingGuardians(t, db, unmarked.ID))
}

// The run marks a contact without a child at the instant its cut-off counts
// from, never at the database's time: under a clock years ahead of the real
// day, a contact marked in this run must not already be past the window. A
// contact the owner creates counts as childless from the same clock, not from
// the column's NOW() default.
func TestDeleteExpiredChildlessGuardiansMarksAtTheRunsInstant(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	runAt := time.Date(2031, time.March, 11, 1, 30, 0, 0, time.UTC)
	moduleAt := func(at time.Time) *Directory {
		t.Helper()
		module, err := New(Dependencies{
			StudentDirectory: testpkg.StudentDirectory{}, DB: db, Observe: func(Observation) {},
			GuardianLinkOwners: testGuardianLinkOwners{Db: db}, GuardianLinkRows: testpkg.GuardianLinks{},
			GuardianRolePresets: lifecyclePresets(), Now: func() time.Time { return at },
		}, testPortalMemberships(db))
		require.NoError(t, err)
		return module
	}
	module := moduleAt(runAt)
	ctx := testpkg.Ctx(t)
	school := testpkg.Tenant(t)
	unmarked := testpkg.CreateTestGuardianProfileForTenant(t, db, school, "Gerade", "Ohne", "retention-run-instant")
	_, err := db.ExecContext(context.Background(), `UPDATE users.guardian_profiles SET childless_since = NULL WHERE id = ?`, unmarked.ID)
	require.NoError(t, err)
	expired := testpkg.CreateTestGuardianProfileForTenant(t, db, school, "Lange", "Ohne", "retention-run-expired")
	_, err = db.ExecContext(context.Background(), `UPDATE users.guardian_profiles SET childless_since = ? WHERE id = ?`, runAt.AddDate(0, 0, -120), expired.ID)
	require.NoError(t, err)
	created, err := module.CreateGuardianContact(ctx, peopledirectory.GuardianContactRecord{FirstName: "Neu", LastName: "Angelegt"})
	require.NoError(t, err)
	profiles := NewGuardianProfileRepository(db, testpkg.StudentDirectory{}, testpkg.GuardianLinks{}, nil, nil, func() time.Time { return runAt })
	legacy := &peopledirectory.GuardianProfileSnapshot{FirstName: "Alt", LastName: "Angelegt", PreferredContactMethod: "phone", LanguagePreference: "de"}
	require.NoError(t, tenant.WithinCurrentTenant(ctx, func(txCtx context.Context) error { return profiles.Create(txCtx, legacy) }))
	noInvitations := func(context.Context, []int64) (map[int64]bool, error) { return nil, nil }

	require.NoError(t, tenant.WithinCurrentTenant(ctx, func(txCtx context.Context) error {
		deleted, err := module.DeleteExpiredChildlessGuardians(txCtx, 90, noInvitations)
		assert.Equal(t, 1, deleted, "only the contact childless for 120 days is past the window")
		return err
	}))
	assert.ElementsMatch(t, []int64{unmarked.ID, created, legacy.ID}, existingGuardians(t, db, unmarked.ID, expired.ID, created, legacy.ID))
	for _, id := range []int64{unmarked.ID, created, legacy.ID} {
		since := childlessSince(t, db, id)
		require.NotNil(t, since)
		assert.True(t, since.Equal(runAt), "guardian %d childless since the clock's instant, got %v", id, since)
	}

	require.NoError(t, tenant.WithinCurrentTenant(ctx, func(txCtx context.Context) error {
		deleted, err := moduleAt(runAt.AddDate(0, 0, 100)).DeleteExpiredChildlessGuardians(txCtx, 90, noInvitations)
		assert.Equal(t, 3, deleted, "100 days later every contact without a child is past the window")
		return err
	}))
	assert.Empty(t, existingGuardians(t, db, unmarked.ID, created, legacy.ID))
}

func childlessSince(t *testing.T, db *bun.DB, guardianID int64) *time.Time {
	t.Helper()
	var since *time.Time
	require.NoError(t, db.NewRaw(`SELECT childless_since FROM users.guardian_profiles WHERE id = ?`, guardianID).Scan(context.Background(), &since))
	return since
}

func existingGuardians(t *testing.T, db *bun.DB, ids ...int64) []int64 {
	t.Helper()
	var found []int64
	require.NoError(t, db.NewSelect().TableExpr("users.guardian_profiles").Column("id").
		Where("id IN (?)", bun.List(ids)).Scan(context.Background(), &found))
	return found
}
