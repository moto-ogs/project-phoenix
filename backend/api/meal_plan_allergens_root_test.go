package api

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/moto-ogs/project-phoenix/api/testutil"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// checkMealPlanAllergens drives the allergen marking of the meal plan
// (#4777) through the production router: a code outside the 14 main
// allergens answers 400 with its registered code, a role without the write
// permission answers 403, and one school never reads another's dishes.
func checkMealPlanAllergens(t *testing.T, api *goldenRuntime) {
	t.Helper()
	testpkg.OwnTenant(t)
	db := testpkg.SetupTestDB(t)
	tenantID := testpkg.Tenant(t)
	testpkg.SetTestTenantSetting(t, db, tenantID, "operations.meal_plan_enabled", "true")
	_, admin := testpkg.CreateTestStaffWithAccountForTenant(t, db, tenantID, "Küche", "Leitung")
	adminToken := testpkg.MintLiveSessionJWT(t, db, testutil.AdminTestClaimsForTenant(int(admin.ID), tenantID))
	send := func(token, method, path, body string) (int, string) {
		response := checkpointRequest(api, checkpointScenario{Method: method, Path: path, Authenticated: true, Body: body}, token)
		return response.Code, response.Body.String()
	}
	const day = "/api/meal-plan/days/2030-01-07"
	const week = "/api/meal-plan/days?week_start=2030-01-07"
	type dish struct {
		Dish      string   `json:"dish"`
		Allergens []string `json:"allergens"`
	}
	read := func(token string) (version string, dishes []dish) {
		status, body := send(token, http.MethodGet, week, "")
		require.Equal(t, http.StatusOK, status, body)
		var response struct {
			Data []struct {
				Version string `json:"version"`
				Dishes  []dish `json:"dishes"`
			} `json:"data"`
		}
		require.NoError(t, json.Unmarshal([]byte(body), &response))
		require.Len(t, response.Data, 5)
		return response.Data[0].Version, response.Data[0].Dishes
	}
	save := func(token, dishes string) (int, string) {
		version, _ := read(adminToken)
		return send(token, http.MethodPut, day, `{"dishes":`+dishes+`,"expected_version":"`+version+`"}`)
	}

	t.Run("unknown code", func(t *testing.T) {
		status, body := save(adminToken, `[{"dish":"Erdbeeren","allergens":["strawberry"]}]`)
		require.Equal(t, http.StatusBadRequest, status, body)
		assert.Contains(t, body, `"code":"meals.invalid_allergens"`)
	})

	t.Run("saved and read in legend order", func(t *testing.T) {
		status, body := save(adminToken, `[{"dish":"Fischstäbchen","note":"mit Salat","allergens":["milk","fish","gluten","fish"]},{"dish":"Obst"}]`)
		require.Equal(t, http.StatusOK, status, body)
		_, dishes := read(adminToken)
		require.Len(t, dishes, 2)
		assert.Equal(t, []string{"gluten", "fish", "milk"}, dishes[0].Allergens)
		assert.Equal(t, []string{}, dishes[1].Allergens, "an unmarked dish answers an empty list")
	})

	t.Run("role without write permission", func(t *testing.T) {
		granted := systemRolePermissions(t, db, identityaccess.GuestRoleName)
		_, guest := testpkg.CreateTestStaffWithAccountForTenant(t, db, tenantID, "Gast", "Konto")
		claims := testutil.TenantUserTestClaims(int(guest.ID), tenantID, granted...)
		claims.Roles = []string{identityaccess.GuestRoleName}
		status, body := save(testpkg.MintLiveSessionJWT(t, db, claims), `[{"dish":"Suppe","allergens":["celery"]}]`)
		require.Equal(t, http.StatusForbidden, status, body)
		assert.Contains(t, body, `"code":"general.`, "the refusal carries a registered code")
	})

	t.Run("other school", func(t *testing.T) {
		other := testpkg.NewTenantScope(t, db).TenantID
		testpkg.SetTestTenantSetting(t, db, other, "operations.meal_plan_enabled", "true")
		_, otherAdmin := testpkg.CreateTestStaffWithAccountForTenant(t, db, other, "Andere", "Schule")
		otherToken := testpkg.MintLiveSessionJWT(t, db, testutil.AdminTestClaimsForTenant(int(otherAdmin.ID), other))
		_, dishes := read(otherToken)
		assert.Empty(t, dishes, "the other school reads none of the dishes")
	})
}
