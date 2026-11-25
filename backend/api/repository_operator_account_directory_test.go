package api

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/moto-ogs/project-phoenix/modules/organizationtenancy"
	owners "github.com/moto-ogs/project-phoenix/roots/owners"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"

	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

func readTestOperatorAccounts(t *testing.T, db *bun.DB, scope organizationtenancy.AccountScope, query organizationtenancy.AccountPageQuery) (page organizationtenancy.AccountPage, err error) {
	t.Helper()
	err = testpkg.WithinAdminContext(t, context.Background(), db, func(ctx context.Context) error {
		page, err = owners.NewOperatorAccountDirectory().ListAccountPage(ctx, scope, query)
		return err
	})
	return page, err
}

func TestOperatorAccountDirectory_ListAccountsByTenantID(t *testing.T) {
	t.Parallel()

	db := testpkg.SetupTestDB(t)
	ctx := testpkg.WithTenantRuntime(t, context.Background(), db)

	tenantID := testpkg.UniqueTestTenantID(t)
	testpkg.EnsureTestTenant(t, db, tenantID)
	account := testpkg.CreateTestAccount(t, db, "list-by-tenant")
	testpkg.MapAccountToTenant(t, db, account.ID, tenantID)

	person := testpkg.CreateTestPersonForTenant(t, db, tenantID, "Maria", "Schmidt")
	_, err := db.ExecContext(ctx,
		`UPDATE users.persons SET account_id = ? WHERE id = ?`, account.ID, person.ID)
	require.NoError(t, err)

	t.Run("returns accounts for tenant", func(t *testing.T) {
		// The composed repository resolves persons through the tenant runtime.
		accountsPage, err := readTestOperatorAccounts(t, db, organizationtenancy.AccountScope{SchoolID: tenantID}, organizationtenancy.AccountPageQuery{})
		require.NoError(t, err)

		var found bool
		for _, a := range accountsPage.Rows {
			if a.Email == account.Email {
				found = true
				assert.Equal(t, ident.ID(account.ID), a.AccountID)
				assert.Equal(t, "Maria", a.FirstName)
				assert.Equal(t, "Schmidt", a.LastName)
				break
			}
		}
		assert.True(t, found, "expected to find test account in results")
	})

	t.Run("returns empty for nonexistent tenant", func(t *testing.T) {
		accountsPage, err := readTestOperatorAccounts(t, db, organizationtenancy.AccountScope{SchoolID: 999999}, organizationtenancy.AccountPageQuery{})
		require.NoError(t, err)
		assert.Empty(t, accountsPage.Rows)
	})
}

func TestOperatorAccountDirectory_ListAccountsByTenantID_IncludesPendingInvitations(t *testing.T) {
	t.Parallel()

	db := testpkg.SetupTestDB(t)
	ctx := testpkg.WithTenantRuntime(t, context.Background(), db)

	tenantID := testpkg.UniqueTestTenantID(t)
	testpkg.EnsureTestTenant(t, db, tenantID)
	role := testpkg.GetOrCreateTestRole(t, db, "admin")

	invitation := testpkg.CreateTestInvitationToken(t, db, "pending-invite", role.ID, 0, testpkg.DatabaseNow(t, db).Add(24*time.Hour))
	_, err := db.ExecContext(ctx,
		`UPDATE auth.invitation_tokens SET tenant_id = ? WHERE id = ?`, tenantID, invitation.ID)
	require.NoError(t, err)

	accountsPage, err := readTestOperatorAccounts(t, db, organizationtenancy.AccountScope{SchoolID: tenantID}, organizationtenancy.AccountPageQuery{})
	require.NoError(t, err)

	var found bool
	for _, a := range accountsPage.Rows {
		if a.Email == invitation.Email {
			found = true
			assert.Equal(t, "invited", a.Status)
			assert.Equal(t, ident.ID(int64(0)), a.AccountID)
			break
		}
	}
	assert.True(t, found, "expected to find pending invitation in results")
}

func TestOperatorAccountDirectory_ListAccountsByOrganizationID(t *testing.T) {
	t.Parallel()

	db := testpkg.SetupTestDB(t)

	tenantID := testpkg.UniqueTestTenantID(t)
	testpkg.EnsureTestTenant(t, db, tenantID)
	orgID := tenantID // EnsureTestTenant creates org with same ID

	account := testpkg.CreateTestAccount(t, db, "list-by-org")
	testpkg.MapAccountToTenant(t, db, account.ID, tenantID)

	t.Run("returns accounts for organization", func(t *testing.T) {
		accountsPage, err := readTestOperatorAccounts(t, db, organizationtenancy.AccountScope{OrganizationID: orgID}, organizationtenancy.AccountPageQuery{})
		require.NoError(t, err)

		var found bool
		for _, a := range accountsPage.Rows {
			if a.Email == account.Email {
				found = true
				assert.Equal(t, ident.ID(tenantID), a.SchoolID)
				break
			}
		}
		assert.True(t, found, "expected to find test account in org results")
	})

	t.Run("returns empty for nonexistent org", func(t *testing.T) {
		accountsPage, err := readTestOperatorAccounts(t, db, organizationtenancy.AccountScope{OrganizationID: 999999}, organizationtenancy.AccountPageQuery{})
		require.NoError(t, err)
		assert.Empty(t, accountsPage.Rows)
	})
}

func TestOperatorAccountDirectory_ListAllAccounts(t *testing.T) {
	t.Parallel()

	// The global first page must not depend on other tests' school fixtures.
	db := testpkg.SetupIsolatedTestDB(t)

	tenantID := testpkg.UniqueTestTenantID(t)
	testpkg.EnsureTestTenant(t, db, tenantID)

	account := testpkg.CreateTestAccount(t, db, "list-all")
	testpkg.MapAccountToTenant(t, db, account.ID, tenantID)

	accountsPage, err := readTestOperatorAccounts(t, db, organizationtenancy.AccountScope{}, organizationtenancy.AccountPageQuery{})
	require.NoError(t, err)

	var found bool
	for _, a := range accountsPage.Rows {
		if a.Email == account.Email {
			found = true
			assert.Equal(t, ident.ID(tenantID), a.SchoolID)
			break
		}
	}
	assert.True(t, found, "expected to find test account in all accounts")
}

// containsAccount reports whether the result list includes an entry for the given email.
func containsAccount(accounts []organizationtenancy.OrganizationAccount, email string) bool {
	for _, a := range accounts {
		if a.Email == email {
			return true
		}
	}
	return false
}

// TestOperatorAccountDirectory_ListAllAccounts_ExcludesDeletedSchool verifies that
// the global org-accounts listing hides accounts whose tenant school is in the
// Papierkorb (soft-deleted), and re-includes them after restore.
func TestOperatorAccountDirectory_ListAllAccounts_ExcludesDeletedSchool(t *testing.T) {
	t.Parallel()

	db := testpkg.SetupIsolatedTestDB(t)
	ctx := testpkg.WithTestTenantRuntime(t, context.Background())

	tenantID := testpkg.UniqueTestTenantID(t)
	testpkg.EnsureTestTenant(t, db, tenantID)

	account := testpkg.CreateTestAccount(t, db, "list-all-deleted")
	// The subject here is an account whose ONLY school is soft-deleted, so the
	// mapping CreateTestAccount adds for the test's own tenant has to go
	// (#2419) — otherwise the account stays visible through that second school.
	testpkg.UnclaimTestAccount(t, db, account.ID)
	testpkg.MapAccountToTenant(t, db, account.ID, tenantID)

	// Baseline: account is visible while school is active.
	accountsPage, err := readTestOperatorAccounts(t, db, organizationtenancy.AccountScope{}, organizationtenancy.AccountPageQuery{})
	require.NoError(t, err)
	require.True(t, containsAccount(accountsPage.Rows, account.Email),
		"baseline: account should be visible while school is active")

	// Soft-delete the school directly to keep the test isolated from
	// SoftDeleteSchool's side effects (token revocation, invitation invalidation).
	_, err = db.ExecContext(ctx,
		`UPDATE platform.schools SET deleted_at = NOW() WHERE id = ?`, tenantID)
	require.NoError(t, err)

	// After soft-delete: account must disappear from global listing.
	accountsPage, err = readTestOperatorAccounts(t, db, organizationtenancy.AccountScope{}, organizationtenancy.AccountPageQuery{})
	require.NoError(t, err)
	require.False(t, containsAccount(accountsPage.Rows, account.Email),
		"account whose school is soft-deleted must not appear in ListAllAccounts")

	// Also hidden when filtered by the parent organization.
	orgAccountsPage, err := readTestOperatorAccounts(t, db, organizationtenancy.AccountScope{OrganizationID: tenantID}, organizationtenancy.AccountPageQuery{})
	require.NoError(t, err)
	require.False(t, containsAccount(orgAccountsPage.Rows, account.Email),
		"account whose school is soft-deleted must not appear in ListAccountsByOrganizationID")

	// Restore: account reappears in both listings.
	_, err = db.ExecContext(ctx,
		`UPDATE platform.schools SET deleted_at = NULL WHERE id = ?`, tenantID)
	require.NoError(t, err)

	accountsPage, err = readTestOperatorAccounts(t, db, organizationtenancy.AccountScope{}, organizationtenancy.AccountPageQuery{})
	require.NoError(t, err)
	assert.True(t, containsAccount(accountsPage.Rows, account.Email),
		"restore: account should be visible again in ListAllAccounts")

	orgAccountsPage, err = readTestOperatorAccounts(t, db, organizationtenancy.AccountScope{OrganizationID: tenantID}, organizationtenancy.AccountPageQuery{})
	require.NoError(t, err)
	assert.True(t, containsAccount(orgAccountsPage.Rows, account.Email),
		"restore: account should be visible again in ListAccountsByOrganizationID")
}

func TestOperatorAccountDirectory_PagesAccountAndInvitationRows(t *testing.T) {
	t.Parallel()

	db := testpkg.SetupTestDB(t)
	ctx := context.Background()
	school := testpkg.Tenant(t)
	otherSchool := testpkg.UniqueTestTenantID(t)
	testpkg.EnsureTestTenant(t, db, otherSchool)
	role := testpkg.GetOrCreateTestRole(t, db, "admin")
	prefix := fmt.Sprintf("account-page-%d", school)
	_, err := db.ExecContext(ctx, `
WITH accounts AS (
	INSERT INTO auth.accounts (email, active)
	SELECT ? || '-' || lpad(i::text, 3, '0') || '@example.test', true
	FROM generate_series(1, 101) AS i ORDER BY i RETURNING id, email
), memberships AS (
	INSERT INTO auth.account_tenants (account_id, tenant_id, status)
	SELECT id, ?, CASE WHEN email LIKE '%-101@%' THEN 'inactive' ELSE 'active' END FROM accounts
	UNION ALL SELECT id, ?, 'active' FROM accounts WHERE email LIKE '%-001@%'
	RETURNING account_id, tenant_id
)
INSERT INTO users.persons (account_id, tenant_id, first_name, last_name)
SELECT account_id, tenant_id, 'Änne', 'Gleich' FROM memberships`, prefix, school, otherSchool)
	require.NoError(t, err)
	_, err = db.ExecContext(ctx, `
INSERT INTO auth.invitation_tokens (email, token, role_id, expires_at, tenant_id, first_name, last_name)
SELECT ? || suffix || '@example.test', encode(sha256(convert_to(uuid_generate_v4()::text, 'UTF8')), 'hex'), ?, now() + validity, ?, 'Änne', 'Gleich'
FROM (VALUES ('-001', interval '1 day'), ('-101', interval '1 day'),
	('-pending', interval '1 day'), ('-expired', interval '-1 day')) AS fixture(suffix, validity) ORDER BY suffix`, prefix, role.ID, school)
	require.NoError(t, err)

	scope := organizationtenancy.AccountScope{SchoolID: school}
	query := organizationtenancy.AccountPageQuery{Sort: "name", Search: strings.ToUpper(prefix)}
	var all []organizationtenancy.OrganizationAccount
	for number, size := range []int{50, 50, 3} {
		page, err := readTestOperatorAccounts(t, db, scope, query)
		require.NoError(t, err)
		require.Len(t, page.Rows, size)
		assert.Equal(t, 103, page.Total)
		assert.Equal(t, number+1, page.Number)
		assert.Equal(t, number == 2, page.NextCursor == "")
		query.Cursor = page.NextCursor
		all = append(all, page.Rows...)
	}
	seen := make(map[[2]ident.ID]bool)
	for _, row := range all {
		key := [2]ident.ID{row.AccountID, row.InvitationID}
		assert.False(t, seen[key], "the same row must not cross the cursor twice")
		seen[key] = true
		assert.Equal(t, "Änne", row.FirstName)
		assert.Equal(t, "Gleich", row.LastName)
	}
	assert.Equal(t, "inactive", all[100].Status)
	assert.Equal(t, "invited", all[101].Status)
	assert.Equal(t, "admin", all[101].RoleName)
	assert.False(t, all[101].HasAdminRole)
	assert.Equal(t, prefix+"-101@example.test", all[101].Email)
	assert.Equal(t, prefix+"-pending@example.test", all[102].Email)

	roleQuery := organizationtenancy.AccountPageQuery{Sort: "roleName", Descending: true, Search: prefix}
	roleFirst, err := readTestOperatorAccounts(t, db, scope, roleQuery)
	require.NoError(t, err)
	require.Len(t, roleFirst.Rows, 50)
	assert.Equal(t, role.Name, roleFirst.Rows[0].RoleName)
	assert.Equal(t, role.Name, roleFirst.Rows[1].RoleName)
	roleQuery.Cursor = roleFirst.NextCursor
	roleSecond, err := readTestOperatorAccounts(t, db, scope, roleQuery)
	require.NoError(t, err)
	require.Len(t, roleSecond.Rows, 50)
	assert.Equal(t, all[48].AccountID, roleSecond.Rows[0].AccountID,
		"the role-sorted cursor crosses equal blank role names without skipping the next account")

	query = organizationtenancy.AccountPageQuery{Sort: "email", Descending: true, Search: prefix}
	first, err := readTestOperatorAccounts(t, db, organizationtenancy.AccountScope{}, query)
	require.NoError(t, err)
	require.Len(t, first.Rows, 50)
	assert.Equal(t, 104, first.Total, "the second school's assignment is also a row")
	assert.Equal(t, prefix+"-pending@example.test", first.Rows[0].Email)
	query.Cursor = first.NextCursor
	_, err = readTestOperatorAccounts(t, db, scope, query)
	require.ErrorAs(t, err, new(*organizationtenancy.InvalidProvisioningDataError))
	query.Cursor = ""
	orgPage, err := readTestOperatorAccounts(t, db, organizationtenancy.AccountScope{OrganizationID: otherSchool}, query)
	require.NoError(t, err)
	require.Len(t, orgPage.Rows, 1)
	assert.Equal(t, all[0].AccountID, orgPage.Rows[0].AccountID)
	assert.Equal(t, ident.ID(otherSchool), orgPage.Rows[0].SchoolID)
}

func TestOperatorAccountDirectorySortsRolesAndKeepsCaregiverFactsAtTheirSchool(t *testing.T) {
	t.Parallel()

	db := testpkg.SetupTestDB(t)
	ctx := testpkg.Ctx(t)
	school := testpkg.Tenant(t)
	otherSchool := testpkg.UniqueTestTenantID(t)
	testpkg.EnsureTestTenant(t, db, otherSchool)
	teacher, account := testpkg.CreateTestTeacherWithAccount(t, db, "Ada", "Listing")
	testpkg.MapAccountToTenant(t, db, account.ID, otherSchool)

	_, plain := testpkg.CreateTestStaffWithAccount(t, db, "Kette", "Ohne Profil")
	localRole := testpkg.CreateTestRole(t, db, "Alpha")
	foreignRole := testpkg.CreateTestRoleForTenant(t, db, "Foreign", otherSchool)
	userRole := testpkg.GetOrCreateTestRole(t, db, "user")
	_, err := db.ExecContext(ctx,
		`INSERT INTO auth.account_roles (account_id, role_id, tenant_id) VALUES (?, ?, ?), (?, ?, ?), (?, ?, ?)`,
		plain.ID, localRole.ID, school, account.ID, userRole.ID, school, account.ID, foreignRole.ID, otherSchool)
	require.NoError(t, err)
	_, err = db.ExecContext(ctx, `UPDATE users.teachers SET role = 'Leitung' WHERE id = ?`, teacher.ID)
	require.NoError(t, err)

	scope := organizationtenancy.AccountScope{SchoolID: school}
	byRole, err := readTestOperatorAccounts(t, db, scope, organizationtenancy.AccountPageQuery{Sort: "roleName"})
	require.NoError(t, err)
	require.Len(t, byRole.Rows, 2)
	assert.Equal(t, ident.ID(plain.ID), byRole.Rows[0].AccountID)
	assert.Equal(t, localRole.Name, byRole.Rows[0].RoleName)
	assert.False(t, byRole.Rows[0].HasCaregiverProfile, "staff without a teacher profile is not a caregiver")
	assert.False(t, byRole.Rows[0].IsActiveCaregiver)
	assert.Equal(t, ident.ID(account.ID), byRole.Rows[1].AccountID)
	assert.Equal(t, userRole.Name, byRole.Rows[1].RoleName)

	query := organizationtenancy.AccountPageQuery{Sort: "pedagogicRole", Descending: true}
	before, err := readTestOperatorAccounts(t, db, scope, query)
	require.NoError(t, err)
	require.Len(t, before.Rows, 2)
	caregiver := before.Rows[0]
	assert.Equal(t, ident.ID(account.ID), caregiver.AccountID)
	assert.Equal(t, "Ada", caregiver.FirstName)
	assert.Equal(t, "Listing", caregiver.LastName)
	assert.Equal(t, "Leitung", caregiver.PedagogicRole)
	assert.True(t, caregiver.HasUserRole)
	assert.True(t, caregiver.HasCaregiverProfile)
	assert.True(t, caregiver.IsActiveCaregiver)

	other, err := readTestOperatorAccounts(t, db, organizationtenancy.AccountScope{SchoolID: otherSchool}, query)
	require.NoError(t, err)
	require.Len(t, other.Rows, 1)
	assert.Equal(t, ident.ID(account.ID), other.Rows[0].AccountID)
	assert.Equal(t, foreignRole.Name, other.Rows[0].RoleName)
	assert.Empty(t, other.Rows[0].PedagogicRole)
	assert.False(t, other.Rows[0].HasCaregiverProfile)
	assert.False(t, other.Rows[0].IsActiveCaregiver)

	_, err = db.ExecContext(ctx, `DELETE FROM auth.account_roles WHERE account_id = ? AND tenant_id = ? AND role_id = ?`, account.ID, school, userRole.ID)
	require.NoError(t, err)
	noUserRole, err := readTestOperatorAccounts(t, db, scope, query)
	require.NoError(t, err)
	require.Len(t, noUserRole.Rows, 2)
	assert.True(t, noUserRole.Rows[0].HasCaregiverProfile)
	assert.False(t, noUserRole.Rows[0].IsActiveCaregiver)

	membership, err := owners.NewSchoolMembership(testpkg.NewDatabase(t, db))
	require.NoError(t, err)
	require.NoError(t, membership.DeleteTeacher(ctx, teacher.ID))
	after, err := readTestOperatorAccounts(t, db, scope, query)
	require.NoError(t, err)
	require.Len(t, after.Rows, 2)
	for _, row := range after.Rows {
		assert.Empty(t, row.PedagogicRole)
		assert.False(t, row.HasCaregiverProfile)
		assert.False(t, row.IsActiveCaregiver)
	}
}
