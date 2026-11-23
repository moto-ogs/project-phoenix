package api

import (
	"net/http"
	"testing"

	"github.com/moto-ogs/project-phoenix/api/testutil"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// checkMealPlanStaleSave drives the save of a meal plan day against the day
// as the saver read it through the production router: a day stored
// differently since answers 409 with its registered code and keeps the
// stored dishes; a matching read state, compared in stored form, saves; a
// save without a read state stays unchecked.
func checkMealPlanStaleSave(t *testing.T, api *goldenRuntime) {
	t.Helper()
	testpkg.OwnTenant(t)
	db := testpkg.SetupTestDB(t)
	tenantID := testpkg.Tenant(t)
	testpkg.SetTestTenantSetting(t, db, tenantID, "operations.meal_plan_enabled", "true")
	_, admin := testpkg.CreateTestStaffWithAccountForTenant(t, db, tenantID, "Küche", "Planung")
	token := testpkg.MintLiveSessionJWT(t, db, testutil.AdminTestClaimsForTenant(int(admin.ID), tenantID))
	send := func(method, path, body string) (int, string) {
		response := checkpointRequest(api, checkpointScenario{Method: method, Path: path, Authenticated: true, Body: body}, token)
		return response.Code, response.Body.String()
	}
	const day = "/api/meal-plan/2030-01-08"
	const week = "/api/meal-plan/?week_start=2030-01-07"

	status, body := send(http.MethodPut, day, `{"dishes":[{"dish":"Suppe","note":"mit Brot","allergens":["milk","gluten"]}],"expected":[]}`)
	require.Equal(t, http.StatusOK, status, "an empty day read as empty saves: %s", body)

	status, body = send(http.MethodPut, day, `{"dishes":[{"dish":"Nudeln"}],"expected":[]}`)
	require.Equal(t, http.StatusConflict, status, body)
	assert.Contains(t, body, `"code":"meals.day_changed"`)
	_, body = send(http.MethodGet, week, "")
	assert.Contains(t, body, "Suppe", "the refused save keeps the stored day")
	assert.NotContains(t, body, "Nudeln")

	status, body = send(http.MethodPut, day, `{"dishes":[{"dish":"Nudeln"}],"expected":[{"dish":" Suppe ","note":"mit Brot ","allergens":["gluten","milk","gluten"]},{"dish":"  "}]}`)
	require.Equal(t, http.StatusOK, status, "the read state compares in stored form: %s", body)

	status, body = send(http.MethodPut, day, `{"dishes":[{"dish":"Eintopf"}]}`)
	require.Equal(t, http.StatusOK, status, "a save without a read state stays unchecked: %s", body)
	_, body = send(http.MethodGet, week, "")
	assert.Contains(t, body, "Eintopf")
}
