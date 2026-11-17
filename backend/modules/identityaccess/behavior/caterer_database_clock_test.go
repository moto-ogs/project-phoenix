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
)

// auth.create_invited_caterer accepts only an invitation whose expires_at
// lies after the database's statement_timestamp() (1.15.604), so the whole
// invitation lives on the database clock (ADR 0285): its expiry, the open
// check of the school's list, the preview and the acceptance. With the Go
// clock a month off, in either direction, a new invitation is still open
// for exactly its lifetime on the database clock and can be accepted.
func TestCatererInvitationDecidesOnTheDatabaseClockWithGoAhead(t *testing.T) {
	t.Parallel()
	assertCatererInvitationOnTheDatabaseClock(t, 31*24*time.Hour)
}

func TestCatererInvitationDecidesOnTheDatabaseClockWithGoBehind(t *testing.T) {
	t.Parallel()
	assertCatererInvitationOnTheDatabaseClock(t, -31*24*time.Hour)
}

// assertCatererInvitationOnTheDatabaseClock invites, previews and accepts
// with the Go clock offset from the database clock.
func assertCatererInvitationOnTheDatabaseClock(t *testing.T, offset time.Duration) {
	t.Helper()
	db := testpkg.SetupTestDB(t)
	databaseNow := testpkg.DatabaseNow(t, db)
	goClock := func() time.Time { return databaseNow.Add(offset) }
	module, err := api.NewTestIdentityAccessWithConfig(testpkg.NewDatabase(t, db), slog.Default(), authTestFactoryConfig(false), goClock)
	require.NoError(t, err)
	caterers := module.Caterers()
	school := testpkg.Tenant(t)
	staff := testpkg.CreateTestAccount(t, db, "caterer-clock-inviter")
	email := fmt.Sprintf("kueche-uhr-%d@example.com", time.Now().UnixNano())
	token := invite(t, db, caterers, school, staff.ID, email)

	var expiresAt time.Time
	require.NoError(t, db.NewRaw(`SELECT expires_at FROM auth.caterer_invitations WHERE tenant_id = ? AND lower(email) = lower(?)`, school, email).
		Scan(context.Background(), &expiresAt))
	assert.WithinDuration(t, databaseNow.Add(14*24*time.Hour), expiresAt, time.Minute, "the lifetime counts from the database clock")

	require.NoError(t, inSchool(t, db, school, func(ctx context.Context) error {
		invitations, err := caterers.ListCatererInvitations(ctx)
		require.Len(t, invitations, 1)
		assert.False(t, invitations[0].Expired, "the school's list shows the invitation open")
		return err
	}))

	var preview identityaccess.CatererInvitationPreview
	require.NoError(t, inSchool(t, db, school, func(ctx context.Context) error {
		var err error
		preview, err = caterers.PreviewCatererInvitation(ctx, token)
		return err
	}))
	assert.Equal(t, email, preview.Email)

	acceptance, err := accept(t, db, caterers, school, token, identityaccess.CatererRegistration{Password: catererPassword, ConfirmPassword: catererPassword})
	require.NoError(t, err, "auth.create_invited_caterer finds the invitation open")
	forgetCaterer(t, db, acceptance)
	assert.Equal(t, school, acceptance.TenantID)
}
