// Router-level tests for the roles a Träger gives the staff of all its
// schools (#4810, ADR 0317): the Träger-Büro creates a role and Identity &
// Access carries it into every school, also into a school that joins later;
// the school assigns the copy but does not change or delete it; a dropped
// right ends the sessions of the people who hold the role; a removal shows
// who holds the role where and removes nothing without that confirmation;
// no other Träger reaches the roles; every change is in the school's ledger
// with the level „Träger“.
package api

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"

	"github.com/moto-ogs/project-phoenix/modules/identityaccess"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	querybudgets "github.com/moto-ogs/project-phoenix/test/query-budgets"
)

type traegerSchoolRoleBody struct {
	ID            wireID   `json:"id"`
	Name          string   `json:"name"`
	BaseRole      string   `json:"base_role"`
	PermissionIDs []wireID `json:"permission_ids"`
	Version       string   `json:"version"`
	Schools       []struct {
		SchoolID  wireID `json:"school_id"`
		Carried   bool   `json:"carried"`
		NameTaken bool   `json:"name_taken"`
		Holders   int    `json:"holders"`
	} `json:"schools"`
}

type traegerSchoolRoleListBody struct {
	Roles   []traegerSchoolRoleBody `json:"roles"`
	Schools []struct {
		ID wireID `json:"id"`
	} `json:"schools"`
}

type traegerSchoolRoleCatalogBody struct {
	Permissions []struct {
		ID       wireID `json:"id"`
		Resource string `json:"resource"`
		Action   string `json:"action"`
	} `json:"permissions"`
	Templates []struct {
		BaseRole      string   `json:"base_role"`
		PermissionIDs []wireID `json:"permission_ids"`
	} `json:"templates"`
}

type traegerSchoolRoleRemovalBody struct {
	Version string `json:"version"`
	Schools []struct {
		SchoolID           wireID `json:"school_id"`
		KeptForInvitations bool   `json:"kept_for_invitations"`
		Holders            []struct {
			AccountID wireID `json:"account_id"`
			Name      string `json:"name"`
		} `json:"holders"`
	} `json:"schools"`
}

const traegerSchoolRolesPath = "/traeger/school-roles/"

func traegerSchoolRolePath(id wireID, suffix string) string {
	return fmt.Sprintf("/traeger/school-roles/%d%s", id, suffix)
}

// schoolRoleCopy returns the school's role that is the copy of the Träger
// role, zero without one.
func schoolRoleCopy(t *testing.T, db *bun.DB, schoolID int64, traegerRoleID wireID) int64 {
	t.Helper()
	var ids []int64
	require.NoError(t, db.NewRaw(`SELECT id FROM auth.roles WHERE tenant_id = ? AND traeger_role_id = ?`, schoolID, int64(traegerRoleID)).Scan(context.Background(), &ids))
	if len(ids) == 0 {
		return 0
	}
	return ids[0]
}

func schoolRolePermissionIDs(t *testing.T, db *bun.DB, roleID int64) []wireID {
	t.Helper()
	ids := []wireID{}
	require.NoError(t, db.NewRaw(`SELECT permission_id FROM auth.role_permissions WHERE role_id = ? ORDER BY permission_id`, roleID).Scan(context.Background(), &ids))
	return ids
}

func giveSchoolRole(t *testing.T, db *bun.DB, schoolID, accountID, roleID int64) {
	t.Helper()
	_, err := db.ExecContext(context.Background(), `INSERT INTO auth.account_roles (account_id, role_id, tenant_id) VALUES (?, ?, ?)`, accountID, roleID, schoolID)
	require.NoError(t, err)
}

// traegerRoleLedger counts the school's ledger entries of the Träger about
// the role with that action.
func traegerRoleLedger(t *testing.T, db *bun.DB, office traegerOffice, schoolID int64, traegerRoleID wireID, action string) int {
	t.Helper()
	return staffSchoolValue(t, db, `SELECT COUNT(*) FROM audit.auth_events
		WHERE tenant_id = ? AND event_type = 'traeger_role_changed'
		  AND metadata->>'level' = 'traeger' AND metadata->>'action' = ?
		  AND (metadata->>'organization_id')::bigint = ? AND (metadata->>'traeger_role_id')::bigint = ?`,
		schoolID, action, office.organization, int64(traegerRoleID))
}

// TestTraegerSchoolRolesReachEverySchoolOfTheTraeger walks the acceptance of
// #4810 end to end.
func TestTraegerSchoolRolesReachEverySchoolOfTheTraeger(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	router, portal, _, unit, _ := newTraegerStaffFixture(t, db)
	office := newTraegerOffice(t, db, portal, "Träger Rollen", identityaccess.TraegerRoleAdministration)
	other := newTraegerOffice(t, db, portal, "Träger Fremd", identityaccess.TraegerRoleAdministration)
	north, south := office.schools[0], office.schools[1]
	identity, err := lifecycleTestModule(testpkg.NewDatabase(t, db), unit, GuardianInvitationTestConfig{})
	require.NoError(t, err)

	rec := traegerJSON(t, router, office.token, http.MethodGet, traegerSchoolRolesPath+"catalog", nil)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	catalog := decode[traegerSchoolRoleCatalogBody](t, rec)
	require.GreaterOrEqual(t, len(catalog.Permissions), 3)
	first, second, third := catalog.Permissions[0].ID, catalog.Permissions[1].ID, catalog.Permissions[2].ID

	t.Run("the catalog offers no platform permission and a starting selection per tier", func(t *testing.T) {
		for _, permission := range catalog.Permissions {
			assert.False(t, identityaccess.IsReservedPermission(permission.Resource+":"+permission.Action), "%s:%s is reserved", permission.Resource, permission.Action)
		}
		require.Len(t, catalog.Templates, 2)
		assert.Equal(t, "user", catalog.Templates[0].BaseRole)
		assert.Equal(t, "admin", catalog.Templates[1].BaseRole)
		assert.NotEmpty(t, catalog.Templates[0].PermissionIDs)
		assert.Greater(t, len(catalog.Templates[1].PermissionIDs), len(catalog.Templates[0].PermissionIDs))
	})

	var role traegerSchoolRoleBody
	t.Run("a new role goes into every school with its rights and into each ledger", func(t *testing.T) {
		rec := traegerJSON(t, router, office.token, http.MethodPost, traegerSchoolRolesPath, map[string]any{
			"name": "Springerkraft", "description": "Hilft an allen Standorten aus", "base_role": "user", "permission_ids": []wireID{first, second},
		})
		require.Equal(t, http.StatusCreated, rec.Code, rec.Body.String())
		role = decode[traegerSchoolRoleBody](t, rec)
		assert.Equal(t, "Springerkraft", role.Name, "the Träger-Büro reads the name as it wrote it")
		require.Len(t, role.Schools, 2)
		for _, school := range []int64{north, south} {
			copyID := schoolRoleCopy(t, db, school, role.ID)
			require.NotZero(t, copyID, "school %d carries the role", school)
			assert.ElementsMatch(t, []wireID{first, second}, schoolRolePermissionIDs(t, db, copyID))
			assert.Equal(t, 1, traegerRoleLedger(t, db, office, school, role.ID, "created"))
		}
		for _, carried := range role.Schools {
			assert.True(t, carried.Carried && !carried.NameTaken)
		}
	})

	t.Run("a school that joins the Träger later carries the role from its first day", func(t *testing.T) {
		later := testpkg.CreateTestSchoolInOrganization(t, db, office.organization, "Träger Rollen OGS West")
		copyID := schoolRoleCopy(t, db, later, role.ID)
		require.NotZero(t, copyID)
		assert.ElementsMatch(t, []wireID{first, second}, schoolRolePermissionIDs(t, db, copyID))
		rec := traegerJSON(t, router, office.token, http.MethodGet, traegerSchoolRolesPath, nil)
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		list := decode[traegerSchoolRoleListBody](t, rec)
		require.Len(t, list.Roles, 1)
		assert.Len(t, list.Roles[0].Schools, 3)
		// The school leaves for the other Träger: its copy stays as a role
		// of its own, and it carries no role of the Träger it left.
		_, err := db.ExecContext(context.Background(), `UPDATE platform.schools SET organization_id = ? WHERE id = ?`, other.organization, later)
		require.NoError(t, err)
		assert.Zero(t, schoolRoleCopy(t, db, later, role.ID))
		assert.Equal(t, 1, staffSchoolValue(t, db, `SELECT COUNT(*) FROM auth.roles WHERE id = ? AND traeger_role_id IS NULL`, copyID))
	})

	t.Run("the school assigns the role but does not change or delete it", func(t *testing.T) {
		copyID := schoolRoleCopy(t, db, north, role.ID)
		err := inSchool(t, unit, north, func(ctx context.Context) error {
			stored, err := identity.GetRole(ctx, copyID)
			require.NoError(t, err)
			require.NotNil(t, stored.TraegerRoleID)
			_, err = identity.UpdateRole(ctx, copyID, identityaccess.RoleChange{Name: "eigener name"}, identityaccess.RoleVersion(stored))
			assert.ErrorIs(t, err, identityaccess.ErrTraegerRoleImmutable)
			selection, err := identity.GetRolePermissions(ctx, copyID)
			require.NoError(t, err)
			_, err = identity.ReplaceRolePermissions(ctx, copyID, []int64{int64(first)}, selection.Version)
			assert.ErrorIs(t, err, identityaccess.ErrTraegerRoleImmutable)
			assert.ErrorIs(t, identity.DeleteRole(ctx, copyID), identityaccess.ErrTraegerRoleImmutable)
			assignable, err := identity.ResolveAssignableSchoolRole(ctx, copyID, north)
			require.NoError(t, err)
			assert.Equal(t, "springerkraft", assignable.Name)
			// The school keeps roles of its own beside it.
			_, err = identity.CreateRole(ctx, "hofaufsicht", "", new("user"))
			return err
		})
		require.NoError(t, err)
		assert.ElementsMatch(t, []wireID{first, second}, schoolRolePermissionIDs(t, db, copyID))
	})

	_, holder := testpkg.CreateTestStaffWithAccountForTenant(t, db, north, "Mira", "Sommer")
	giveSchoolRole(t, db, north, holder.ID, schoolRoleCopy(t, db, north, role.ID))

	t.Run("an added right keeps the sessions, a dropped right ends them", func(t *testing.T) {
		testpkg.CreateTestTokenForTenant(t, db, north, holder.ID)
		sessions := func() int {
			return staffSchoolValue(t, db, `SELECT COUNT(*) FROM auth.tokens WHERE account_id = ? AND tenant_id = ?`, holder.ID, north)
		}
		save := func(permissions []wireID) {
			rec := traegerJSON(t, router, office.token, http.MethodPut, traegerSchoolRolePath(role.ID, ""), map[string]any{
				"name": "Springerkraft", "description": "Hilft an allen Standorten aus", "base_role": "user",
				"permission_ids": permissions, "expected_version": role.Version,
			})
			require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
			role = decode[traegerSchoolRoleBody](t, rec)
		}
		save([]wireID{first, second, third})
		assert.Equal(t, 1, sessions(), "the renewal reads the added right; nobody is signed out")
		for _, school := range []int64{north, south} {
			assert.ElementsMatch(t, []wireID{first, second, third}, schoolRolePermissionIDs(t, db, schoolRoleCopy(t, db, school, role.ID)))
		}
		assert.Equal(t, 1, role.Schools[0].Holders+role.Schools[1].Holders)
		save([]wireID{first})
		assert.Zero(t, sessions(), "a dropped right ends the sessions of the person who holds the role")
		assert.Equal(t, 2, traegerRoleLedger(t, db, office, north, role.ID, "updated"))
	})

	t.Run("a stale form, a taken name and a platform right are refused", func(t *testing.T) {
		body := func(name, version string, permissions ...wireID) map[string]any {
			return map[string]any{"name": name, "base_role": "user", "permission_ids": permissions, "expected_version": version}
		}
		for _, version := range []string{"2026-01-01T00:00:00Z", ""} {
			rec := traegerJSON(t, router, office.token, http.MethodPut, traegerSchoolRolePath(role.ID, ""), body("Springerkraft", version, first))
			assertStaffRefusal(t, rec, http.StatusConflict, "general.changed_since_read")
		}
		rec := traegerJSON(t, router, office.token, http.MethodPost, traegerSchoolRolesPath, body("SPRINGERKRAFT", ""))
		assertStaffRefusal(t, rec, http.StatusConflict, "traeger.school_role_name_taken")
		rec = traegerJSON(t, router, office.token, http.MethodPost, traegerSchoolRolesPath, body("Admin", ""))
		assertStaffRefusal(t, rec, http.StatusConflict, "traeger.school_role_name_taken")
		// The north school made „hofaufsicht“ a role of its own above.
		rec = traegerJSON(t, router, office.token, http.MethodPost, traegerSchoolRolesPath, body("Hofaufsicht", ""))
		assertStaffRefusal(t, rec, http.StatusConflict, "traeger.school_role_name_used_at_school")
		rec = traegerJSON(t, router, office.token, http.MethodPost, traegerSchoolRolesPath, map[string]any{"name": "Ohne Stufe", "base_role": "guardian"})
		assertStaffRefusal(t, rec, http.StatusBadRequest, "general.input")
		reserved := wireID(staffSchoolValue(t, db, `SELECT id FROM auth.permissions WHERE resource = 'system' AND action = 'manage'`))
		rec = traegerJSON(t, router, office.token, http.MethodPost, traegerSchoolRolesPath, body("Plattform", "", reserved))
		assertStaffRefusal(t, rec, http.StatusBadRequest, "identity.role_platform_permission")
		assert.Equal(t, 1, staffSchoolValue(t, db, `SELECT COUNT(*) FROM auth.traeger_school_roles WHERE organization_id = ?`, office.organization))
	})

	t.Run("no role without the right and no other Träger reaches the roles", func(t *testing.T) {
		readOnly := newTraegerOffice(t, db, portal, "Träger Lesen", identityaccess.TraegerRoleReadOnly)
		rec := traegerJSON(t, router, readOnly.token, http.MethodGet, traegerSchoolRolesPath, nil)
		assert.Equal(t, http.StatusForbidden, rec.Code, rec.Body.String())
		rec = traegerJSON(t, router, other.token, http.MethodGet, traegerSchoolRolesPath, nil)
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		assert.Empty(t, decode[traegerSchoolRoleListBody](t, rec).Roles)
		rec = traegerJSON(t, router, other.token, http.MethodPut, traegerSchoolRolePath(role.ID, ""), map[string]any{"name": "Fremd", "base_role": "user", "expected_version": role.Version})
		assertStaffRefusal(t, rec, http.StatusNotFound, "traeger.school_role_not_found")
		rec = traegerJSON(t, router, other.token, http.MethodGet, traegerSchoolRolePath(role.ID, "/removal-preview"), nil)
		assertStaffRefusal(t, rec, http.StatusNotFound, "traeger.school_role_not_found")
		for _, school := range other.schools {
			assert.Zero(t, schoolRoleCopy(t, db, school, role.ID), "a school of another Träger carries nothing")
		}
	})

	t.Run("a removal shows who holds the role where and removes nothing unconfirmed", func(t *testing.T) {
		rec := traegerJSON(t, router, office.token, http.MethodPost, traegerSchoolRolePath(role.ID, "/removal"), map[string]any{})
		assertStaffRefusal(t, rec, http.StatusConflict, "general.changed_since_read")
		rec = traegerJSON(t, router, office.token, http.MethodGet, traegerSchoolRolePath(role.ID, "/removal-preview"), nil)
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		preview := decode[traegerSchoolRoleRemovalBody](t, rec)
		require.Len(t, preview.Schools, 2)
		require.Len(t, preview.Schools[0].Holders, 1)
		assert.Equal(t, "Mira Sommer", preview.Schools[0].Holders[0].Name)
		assert.Empty(t, preview.Schools[1].Holders)

		// The south school gives the role to somebody after the preview.
		_, late := testpkg.CreateTestStaffWithAccountForTenant(t, db, south, "Jonas", "Winter")
		southCopy := schoolRoleCopy(t, db, south, role.ID)
		giveSchoolRole(t, db, south, late.ID, southCopy)
		rec = traegerJSON(t, router, office.token, http.MethodPost, traegerSchoolRolePath(role.ID, "/removal"), map[string]any{"expected_version": preview.Version})
		assertStaffRefusal(t, rec, http.StatusConflict, "general.changed_since_read")
		assert.NotZero(t, schoolRoleCopy(t, db, north, role.ID), "nothing is removed that the preview did not show")

		rec = traegerJSON(t, router, office.token, http.MethodGet, traegerSchoolRolePath(role.ID, "/removal-preview"), nil)
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		preview = decode[traegerSchoolRoleRemovalBody](t, rec)
		rec = traegerJSON(t, router, office.token, http.MethodPost, traegerSchoolRolePath(role.ID, "/removal"), map[string]any{"expected_version": preview.Version})
		require.Equal(t, http.StatusNoContent, rec.Code, rec.Body.String())
		for _, school := range []int64{north, south} {
			assert.Zero(t, schoolRoleCopy(t, db, school, role.ID))
			assert.Equal(t, 1, traegerRoleLedger(t, db, office, school, role.ID, "removed"))
		}
		assert.Zero(t, staffSchoolValue(t, db, `SELECT COUNT(*) FROM auth.account_roles WHERE role_id = ?`, southCopy))
		assert.Zero(t, staffSchoolValue(t, db, `SELECT COUNT(*) FROM auth.traeger_school_roles WHERE organization_id = ?`, office.organization))
		assert.Equal(t, 1, staffSchoolValue(t, db, `SELECT COUNT(*) FROM auth.roles WHERE tenant_id = ? AND name = 'hofaufsicht'`, north), "the school's own role stays")
	})
}

// TestTraegerSchoolRoleStaysWhereAnInvitationNamesIt covers the one case a
// copy cannot be deleted: an invitation of the school names it.
func TestTraegerSchoolRoleStaysWhereAnInvitationNamesIt(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	router, portal, _, _, _ := newTraegerStaffFixture(t, db)
	office := newTraegerOffice(t, db, portal, "Träger Einladung", identityaccess.TraegerRoleAdministration)
	north, south := office.schools[0], office.schools[1]
	rec := traegerJSON(t, router, office.token, http.MethodPost, traegerSchoolRolesPath, map[string]any{"name": "Küchenhilfe", "base_role": "user"})
	require.Equal(t, http.StatusCreated, rec.Code, rec.Body.String())
	role := decode[traegerSchoolRoleBody](t, rec)
	_, inviter := testpkg.CreateTestStaffWithAccountForTenant(t, db, north, "Lea", "Herbst")
	northCopy := schoolRoleCopy(t, db, north, role.ID)
	_, err := db.ExecContext(context.Background(), `INSERT INTO auth.invitation_tokens (tenant_id, email, token, role_id, created_by, expires_at)
		VALUES (?, ?, ?, ?, ?, now() + interval '1 day')`, north, fmt.Sprintf("kueche-%d@example.org", northCopy), fmt.Sprintf("%064x", northCopy), northCopy, inviter.ID)
	require.NoError(t, err)

	rec = traegerJSON(t, router, office.token, http.MethodGet, traegerSchoolRolePath(role.ID, "/removal-preview"), nil)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	preview := decode[traegerSchoolRoleRemovalBody](t, rec)
	require.Len(t, preview.Schools, 2)
	assert.True(t, preview.Schools[0].KeptForInvitations)
	assert.False(t, preview.Schools[1].KeptForInvitations)
	rec = traegerJSON(t, router, office.token, http.MethodPost, traegerSchoolRolePath(role.ID, "/removal"), map[string]any{"expected_version": preview.Version})
	require.Equal(t, http.StatusNoContent, rec.Code, rec.Body.String())
	assert.Equal(t, 1, staffSchoolValue(t, db, `SELECT COUNT(*) FROM auth.roles WHERE id = ? AND traeger_role_id IS NULL`, northCopy), "the invitation keeps its role, now the school's own")
	assert.Zero(t, schoolRoleCopy(t, db, south, role.ID))
	assert.Equal(t, 1, traegerRoleLedger(t, db, office, north, role.ID, "released"))
}

// TestTraegerSchoolRolesQueryBudget pins the statements of the list: flat in
// the number of roles and holders at a fixed set of schools.
func TestTraegerSchoolRolesQueryBudget(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	router, portal, _, _, _ := newTraegerStaffFixture(t, db)
	office := newTraegerOffice(t, db, portal, "Träger Budget", identityaccess.TraegerRoleAdministration)
	read := func() testpkg.QueryMeasurement {
		counter := testpkg.CaptureQueriesForContext(t, db)
		req := httptest.NewRequest(http.MethodGet, traegerSchoolRolesPath, nil)
		req.Header.Set("Authorization", "Bearer "+office.token)
		rec := httptest.NewRecorder()
		testpkg.MeasuredHTTPRequest(counter, router, rec, req.WithContext(counter.Context(req.Context())))
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		return counter.Measurement(counter.Selects(""))
	}
	created := 0
	add := func(n int) {
		for ; created < n; created++ {
			rec := traegerJSON(t, router, office.token, http.MethodPost, traegerSchoolRolesPath, map[string]any{"name": fmt.Sprintf("Rolle %d", created), "base_role": "user"})
			require.Equal(t, http.StatusCreated, rec.Code, rec.Body.String())
			role := decode[traegerSchoolRoleBody](t, rec)
			_, holder := testpkg.CreateTestStaffWithAccountForTenant(t, db, office.schools[0], "Budget", fmt.Sprintf("Person%d", created))
			giveSchoolRole(t, db, office.schools[0], holder.ID, schoolRoleCopy(t, db, office.schools[0], role.ID))
		}
	}
	add(1)
	few := read()
	add(4)
	assert.Len(t, read().Statements, len(few.Statements), "the list loads set-based")
	querybudgets.AssertQueryBudget(t, "api.traeger.school_roles", few)
}
