package behavior_test

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/modules/identityaccess"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// A password change is authorized by the current password, so a wrong one
// leaves the stored credential exactly as it was.
func TestChangeAccountPasswordKeepsTheCredentialOnAWrongCurrentPassword(t *testing.T) {
	t.Parallel()

	db := testpkg.SetupTestDB(t)
	administration := setupAuthFactory(t, db)

	email := fmt.Sprintf("change-password-%d@test.local", time.Now().UnixNano())
	account := testpkg.CreateTestAccountWithPassword(t, db, email, testPassword)

	before := accountPasswordHash(t, db, account.ID)
	require.NotEmpty(t, before)

	err := administration.ChangeAccountPassword(context.Background(), identityaccess.OwnPasswordChange{AccountID: account.ID, CurrentPassword: "WrongPassword1!", NewPassword: testNewPassword})
	require.ErrorIs(t, err, identityaccess.ErrInvalidCredentials)
	assert.Equal(t, before, accountPasswordHash(t, db, account.ID))

	require.NoError(t, administration.ChangeAccountPassword(context.Background(), identityaccess.OwnPasswordChange{AccountID: account.ID, CurrentPassword: testPassword, NewPassword: testNewPassword}))
	assert.NotEqual(t, before, accountPasswordHash(t, db, account.ID), "the accepted change replaces the credential")
}

func TestAccountAdministrationIgnoresErasedAccounts(t *testing.T) {
	t.Parallel()

	db := testpkg.SetupTestDB(t)
	administration := setupAuthFactory(t, db)
	ctx := testpkg.Ctx(t)
	account := testpkg.CreateTestAccountWithPassword(t, db, fmt.Sprintf("erased-administration-%d@test.local", time.Now().UnixNano()), testPassword)
	tenantID := testpkg.Tenant(t)
	testpkg.EnsureAccountTenant(t, db, account.ID, tenantID)
	role := testpkg.CreateTestRoleForTenant(t, db, "erased-administration-role", tenantID)
	_, err := db.NewRaw(`INSERT INTO auth.account_roles (account_id, role_id, tenant_id) VALUES (?, ?, ?)`, account.ID, role.ID, tenantID).Exec(ctx)
	require.NoError(t, err)
	beforeHash := accountPasswordHash(t, db, account.ID)
	_, err = db.NewRaw(`UPDATE auth.accounts SET personal_data_erased_at = NOW() WHERE id = ?`, account.ID).Exec(ctx)
	require.NoError(t, err)

	_, err = administration.FindManageableAccount(ctx, account.ID)
	require.ErrorIs(t, err, identityaccess.ErrAccountNotFound)
	require.ErrorIs(t, administration.DeactivateAccount(ctx, account.ID), identityaccess.ErrAccountNotFound)
	require.ErrorIs(t, administration.ChangeAccountPassword(ctx, identityaccess.OwnPasswordChange{AccountID: account.ID, CurrentPassword: testPassword, NewPassword: testNewPassword}), identityaccess.ErrAccountNotFound)

	var current struct {
		Email        string `bun:"email"`
		Active       bool   `bun:"active"`
		PasswordHash string `bun:"password_hash"`
	}
	require.NoError(t, db.NewRaw(`SELECT email, active, password_hash FROM auth.accounts WHERE id = ?`, account.ID).Scan(ctx, &current))
	assert.Equal(t, account.Email, current.Email)
	assert.Equal(t, account.Active, current.Active)
	assert.Equal(t, beforeHash, current.PasswordHash)
}
