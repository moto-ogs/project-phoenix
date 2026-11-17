package postgres

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"

	"github.com/moto-ogs/project-phoenix/modules/identityaccess/internal/domain"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// The acceptance's writes check the expiry at their own database time (ADR
// 0285), so an invitation that expires after the acceptance read it is not
// spent: the guarded update spends nothing, and the caterer of a new address
// is refused with ErrInvitationExpired before auth.create_invited_caterer
// runs. A refusal of the function's other guards keeps its SQLSTATE 42501.
func TestCatererInvitationWritesRefuseAnInvitationExpiredAtTheirOwnTime(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	store := NewStore(db, func() time.Time { panic("the caterer invitation reads no owner clock") })
	school := testpkg.Tenant(t)
	email := fmt.Sprintf("kueche-schreiben-%d@example.com", time.Now().UnixNano())
	account := testpkg.CreateTestAccount(t, db, "caterer-write-expiry")
	expired := insertCatererInvitation(t, db, school, email, "statement_timestamp() - interval '1 second'")
	open := insertCatererInvitation(t, db, school, email, "statement_timestamp() + interval '1 hour'")

	inSchool := func(fn func(context.Context) error) error {
		return testpkg.WithinTenantContext(t, context.Background(), db, school, fn)
	}
	require.NoError(t, inSchool(func(ctx context.Context) error {
		accepted, _, err := store.AcceptCatererInvitation(ctx, expired, account.ID)
		assert.False(t, accepted, "the update spends no expired invitation")
		return err
	}))
	err := inSchool(func(ctx context.Context) error {
		_, _, err := store.CreateInvitedCaterer(ctx, expired, account.ID)
		return err
	})
	require.ErrorIs(t, err, domain.ErrInvitationExpired)
	err = inSchool(func(ctx context.Context) error {
		_, _, err := store.CreateInvitedCaterer(ctx, open, account.ID)
		return err
	})
	require.NotErrorIs(t, err, domain.ErrInvitationExpired)
	assert.Equal(t, "42501", testpkg.PostgresSQLState(err), "an account of another address stays refused by the function")
}

func insertCatererInvitation(t *testing.T, db *bun.DB, school int64, email, expiresAt string) int64 {
	t.Helper()
	var id int64
	require.NoError(t, db.NewRaw(`INSERT INTO auth.caterer_invitations (tenant_id, token_hash, email, caterer_name, delivery_address, expires_at)
		VALUES (?, ?, ?, 'Küche am Markt', 'Schulstraße 1', `+expiresAt+`) RETURNING id`,
		school, fmt.Sprintf("hash-%d", time.Now().UnixNano()), email).Scan(context.Background(), &id))
	t.Cleanup(func() {
		_, err := db.NewRaw(`DELETE FROM auth.caterer_invitations WHERE id = ?`, id).Exec(context.Background())
		require.NoError(t, err)
	})
	return id
}
