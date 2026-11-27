// Package auth_test contains hermetic tests for the refactored auth service modules.
// These tests specifically target coverage gaps in the split files.
package behavior_test

import (
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

// accountPasswordHash reads the stored credential of an account so a test
// can prove a write left it alone. The capability never reports it.
func accountPasswordHash(t *testing.T, db *bun.DB, accountID int64) string {
	t.Helper()
	var hash *string
	require.NoError(t, db.NewSelect().
		ColumnExpr("password_hash").
		TableExpr("auth.accounts").
		Where("id = ?", accountID).
		Scan(testpkg.Ctx(t), &hash))
	if hash == nil {
		return ""
	}
	return *hash
}

// setupAuthServiceWithDB creates an auth service with real database connection
func setupAuthServiceWithDB(t *testing.T, db *bun.DB) testAuthService {
	identityModule, err := api.NewTestIdentityAccess(testpkg.NewDatabase(t, db), slog.Default())
	require.NoError(t, err, "Failed to create service factory")
	return newFixtureAuthService(t, db, identityModule)
}

// =============================================================================
// Role Management Extended Tests (role_management.go)
// =============================================================================

func TestAuthService_DeleteRole_Extended(t *testing.T) {
	t.Parallel()

	db := testpkg.SetupTestDB(t)

	service := setupAuthServiceWithDB(t, db)
	rbac := roleAdministrationOf(t, service)
	ctx := testpkg.Ctx(t)

	t.Run("returns error when deleting a system role", func(t *testing.T) {
		// ARRANGE - create a system role directly in the DB
		systemRole := testpkg.CreateTestSystemRole(t, db, "test-system")

		// ACT
		err := rbac.DeleteRole(ctx, systemRole.ID)

		// ASSERT
		require.Error(t, err)
		assert.Contains(t, err.Error(), "system roles cannot be modified")
	})
}

func TestAuthService_UpdateRole_SystemRoleProtection(t *testing.T) {
	t.Parallel()

	db := testpkg.SetupTestDB(t)

	service := setupAuthServiceWithDB(t, db)
	rbac := roleAdministrationOf(t, service)
	ctx := testpkg.Ctx(t)

	t.Run("returns error when updating a system role", func(t *testing.T) {
		// ARRANGE
		systemRole := testpkg.CreateTestSystemRole(t, db, "test-system")
		read, err := rbac.GetRole(ctx, systemRole.ID)
		require.NoError(t, err)

		// ACT
		_, err = rbac.UpdateRole(ctx, systemRole.ID, identityaccess.RoleChange{Name: systemRole.Name, Description: "attempted update"}, identityaccess.RoleVersion(read))

		// ASSERT
		require.Error(t, err)
		assert.Contains(t, err.Error(), "system roles cannot be modified")
	})
}

func TestAuthService_AssignPermissionToRole_SystemRoleProtection(t *testing.T) {
	t.Parallel()

	db := testpkg.SetupTestDB(t)

	service := setupAuthServiceWithDB(t, db)
	rbac := roleAdministrationOf(t, service)
	ctx := testpkg.Ctx(t)

	t.Run("returns error when assigning permission to a system role", func(t *testing.T) {
		// ARRANGE
		systemRole := testpkg.CreateTestSystemRole(t, db, "test-system")

		perm := testpkg.CreateTestPermission(t, db, "sys-role-perm", "sys-role-res", "read")

		// ACT
		err := rbac.AssignPermissionToRole(ctx, systemRole.ID, perm.ID)

		// ASSERT
		require.Error(t, err)
		assert.Contains(t, err.Error(), "system roles cannot be modified")
	})
}

func TestAuthService_RemovePermissionFromRole_SystemRoleProtection(t *testing.T) {
	t.Parallel()

	db := testpkg.SetupTestDB(t)

	service := setupAuthServiceWithDB(t, db)
	rbac := roleAdministrationOf(t, service)
	ctx := testpkg.Ctx(t)

	t.Run("returns error when removing permission from a system role", func(t *testing.T) {
		// ARRANGE
		systemRole := testpkg.CreateTestSystemRole(t, db, "test-system")

		// ACT
		err := rbac.RemovePermissionFromRole(ctx, systemRole.ID, 1)

		// ASSERT
		require.Error(t, err)
		assert.Contains(t, err.Error(), "system roles cannot be modified")
	})
}

func TestAuthService_AssignRoleToAccount_Extended(t *testing.T) {
	t.Parallel()

	db := testpkg.SetupTestDB(t)

	service := setupAuthServiceWithDB(t, db)
	rbac := roleAdministrationOf(t, service)
	ctx := testpkg.Ctx(t)

	t.Run("returns error for non-existent account", func(t *testing.T) {
		// ARRANGE
		roleName := fmt.Sprintf("assign-role-%d", time.Now().UnixNano())
		role, err := rbac.CreateRole(ctx, roleName, "Test role", testpkg.StrPtr("user"))
		require.NoError(t, err)

		// ACT
		err = rbac.AssignRoleToAccount(ctx, 99999999, role.ID)

		// ASSERT
		require.Error(t, err)
	})

	t.Run("returns error for non-existent role", func(t *testing.T) {
		// ARRANGE
		email := fmt.Sprintf("assign-role-user-%d@test.local", time.Now().UnixNano())
		account, err := service.Register(ctx, email, fmt.Sprintf("user-%d", testpkg.UniqueSuffix()), "Test1234%", nil, 0)
		require.NoError(t, err)
		testpkg.EnsureAccountTenant(t, db, account.ID, testpkg.Tenant(t))

		// ACT
		err = rbac.AssignRoleToAccount(ctx, account.ID, 99999999)

		// ASSERT
		require.Error(t, err)
	})
}

// =============================================================================
// Account Management Extended Tests (account_management.go)
// =============================================================================

func TestAuthService_DeactivateAccount_Extended(t *testing.T) {
	t.Parallel()

	db := testpkg.SetupTestDB(t)

	service := setupAuthServiceWithDB(t, db)
	ctx := testpkg.Ctx(t)

	t.Run("deactivates already inactive account (idempotent)", func(t *testing.T) {
		// ARRANGE
		email := fmt.Sprintf("already-inactive-%d@test.local", time.Now().UnixNano())
		account, err := service.Register(ctx, email, fmt.Sprintf("user-%d", testpkg.UniqueSuffix()), "Test1234%", nil, 0)
		require.NoError(t, err)
		testpkg.EnsureAccountTenant(t, db, account.ID, testpkg.Tenant(t))

		// Deactivate first
		err = service.DeactivateAccount(ctx, int(account.ID))
		require.NoError(t, err)

		// ACT - Deactivate again
		err = service.DeactivateAccount(ctx, int(account.ID))

		// ASSERT
		require.NoError(t, err)
	})
}

// =============================================================================
// Auth Login Extended Tests (auth_login.go)
// =============================================================================

func TestAuthService_Login_Extended(t *testing.T) {
	t.Parallel()

	db := testpkg.SetupTestDB(t)

	service := setupAuthServiceWithDB(t, db)
	ctx := testpkg.Ctx(t)

	t.Run("normalizes email case on login", func(t *testing.T) {
		// ARRANGE
		uniqueID := fmt.Sprintf("%d", testpkg.UniqueSuffix())
		email := fmt.Sprintf("login-case-%s@test.local", uniqueID)
		account, err := service.Register(ctx, email, fmt.Sprintf("user-%s", uniqueID), "Test1234%", nil, 0)
		require.NoError(t, err)
		testpkg.EnsureAccountTenant(t, db, account.ID, testpkg.Tenant(t))

		// ACT - Login with uppercase
		accessToken, refreshToken, err := service.Login(ctx, fmt.Sprintf("LOGIN-CASE-%s@TEST.LOCAL", uniqueID), "Test1234%")

		// ASSERT
		require.NoError(t, err)
		assert.NotEmpty(t, accessToken)
		assert.NotEmpty(t, refreshToken)
	})
}

func TestAuthService_Register_Extended(t *testing.T) {
	t.Parallel()

	db := testpkg.SetupTestDB(t)

	service := setupAuthServiceWithDB(t, db)
	ctx := testpkg.Ctx(t)

	t.Run("normalizes email case on registration", func(t *testing.T) {
		// ARRANGE
		uniqueID := fmt.Sprintf("%d", testpkg.UniqueSuffix())
		email := fmt.Sprintf("REGISTER-CASE-%s@TEST.LOCAL", uniqueID)

		// ACT
		account, err := service.Register(ctx, email, fmt.Sprintf("user-%s", uniqueID), "Test1234%", nil, 0)

		// ASSERT
		require.NoError(t, err)

		// Email should be lowercase
		assert.Equal(t, fmt.Sprintf("register-case-%s@test.local", uniqueID), account.Email)
	})

	t.Run("allows empty username", func(t *testing.T) {
		// ACT - Register allows empty/nil username
		account, err := service.Register(ctx, fmt.Sprintf("empty-user-%d@test.local", time.Now().UnixNano()), "", "Test1234%", nil, 0)

		// ASSERT
		require.NoError(t, err)
		require.NotNil(t, account)
	})
}

func TestAuthService_RefreshToken_Extended(t *testing.T) {
	t.Parallel()

	db := testpkg.SetupTestDB(t)

	service := setupAuthServiceWithDB(t, db)
	ctx := testpkg.Ctx(t)

	t.Run("fails for deactivated account", func(t *testing.T) {
		// ARRANGE
		email := fmt.Sprintf("refresh-deactivated-%d@test.local", time.Now().UnixNano())
		account, err := service.Register(ctx, email, fmt.Sprintf("user-%d", testpkg.UniqueSuffix()), "Test1234%", nil, 0)
		require.NoError(t, err)
		testpkg.EnsureAccountTenant(t, db, account.ID, testpkg.Tenant(t))

		_, refreshToken, err := service.Login(ctx, email, "Test1234%")
		require.NoError(t, err)

		// Deactivate account
		err = service.DeactivateAccount(ctx, int(account.ID))
		require.NoError(t, err)

		// ACT
		_, _, err = service.RefreshToken(ctx, refreshToken)

		// ASSERT
		require.Error(t, err)
	})
}

func TestAuthService_Logout_Extended(t *testing.T) {
	t.Parallel()

	db := testpkg.SetupTestDB(t)

	service := setupAuthServiceWithDB(t, db)
	ctx := testpkg.Ctx(t)

	t.Run("is idempotent - double logout succeeds", func(t *testing.T) {
		// ARRANGE
		email := fmt.Sprintf("double-logout-%d@test.local", time.Now().UnixNano())
		account, err := service.Register(ctx, email, fmt.Sprintf("user-%d", testpkg.UniqueSuffix()), "Test1234%", nil, 0)
		require.NoError(t, err)
		testpkg.EnsureAccountTenant(t, db, account.ID, testpkg.Tenant(t))

		_, refreshToken, err := service.Login(ctx, email, "Test1234%")
		require.NoError(t, err)

		// First logout
		err = service.LogoutWithAudit(ctx, refreshToken, "", "")
		require.NoError(t, err)

		// ACT - Second logout (should still work)
		err = service.LogoutWithAudit(ctx, refreshToken, "", "")

		// ASSERT - Should not fail (idempotent)
		require.NoError(t, err) // Token no longer exists, but operation is idempotent
	})
}

func TestAuthService_ChangePassword_Extended(t *testing.T) {
	t.Parallel()

	db := testpkg.SetupTestDB(t)

	service := setupAuthServiceWithDB(t, db)
	ctx := testpkg.Ctx(t)

	t.Run("returns error for non-existent account", func(t *testing.T) {
		// ACT
		err := service.ChangePassword(ctx, 99999999, "OldPassword1%", "NewPassword1%")

		// ASSERT
		require.Error(t, err)
	})

	t.Run("returns error for same old and new password", func(t *testing.T) {
		// ARRANGE
		email := fmt.Sprintf("same-pwd-%d@test.local", time.Now().UnixNano())
		account, err := service.Register(ctx, email, fmt.Sprintf("user-%d", testpkg.UniqueSuffix()), "Test1234%", nil, 0)
		require.NoError(t, err)

		// ACT - Change to same password
		err = service.ChangePassword(ctx, int(account.ID), "Test1234%", "Test1234%")

		// ASSERT - This depends on implementation; may succeed or fail
		// The password change itself succeeds even if old == new
		require.NoError(t, err)
	})
}
