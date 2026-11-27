package api

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/moto-ogs/project-phoenix/api/testutil"
	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// checkMealPlanStaleSave drives the save of a meal plan day against the
// version its saver read (ADR 0311) through the production router: the week
// read and the save's answer give the same version for the stored day, an
// outdated or missing version answers 409 with its registered code and keeps
// the stored dishes, and the deprecated save with the day as read checks it
// in stored form.
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
	type day struct {
		Date    string `json:"date"`
		Version string `json:"version"`
		Dishes  []struct {
			Dish string `json:"dish"`
		} `json:"dishes"`
	}
	read := func() day {
		status, body := send(http.MethodGet, "/api/meal-plan/days?week_start=2030-01-07", "")
		require.Equal(t, http.StatusOK, status, body)
		var response struct{ Data []day }
		require.NoError(t, json.Unmarshal([]byte(body), &response))
		require.Len(t, response.Data, 5)
		require.Equal(t, "2030-01-08", response.Data[1].Date)
		require.NotEmpty(t, response.Data[1].Version, "an empty day has a version too")
		return response.Data[1]
	}
	const path = "/api/meal-plan/days/2030-01-08"

	empty := read()
	status, body := send(http.MethodPut, path, `{"dishes":[{"dish":" Suppe ","note":"mit Brot ","allergens":["milk","gluten","milk"]},{"dish":"  "}],"expected_version":"`+empty.Version+`"}`)
	require.Equal(t, http.StatusOK, status, "the version of the empty day as read saves: %s", body)
	var saved struct{ Data day }
	require.NoError(t, json.Unmarshal([]byte(body), &saved))
	stored := read()
	assert.Equal(t, stored.Version, saved.Data.Version, "the save answers the version the next read gives for the stored day")
	assert.NotEqual(t, empty.Version, stored.Version)

	for name, version := range map[string]string{"outdated": empty.Version, "missing": ""} {
		status, body = send(http.MethodPut, path, `{"dishes":[{"dish":"Nudeln"}],"expected_version":"`+version+`"}`)
		require.Equal(t, http.StatusConflict, status, "%s version: %s", name, body)
		assert.Contains(t, body, `"code":"general.changed_since_read"`)
		assert.Equal(t, stored.Version, read().Version, "the refused save keeps the stored day")
	}

	status, body = send(http.MethodPut, path, `{"dishes":[{"dish":"Nudeln"}],"expected_version":"`+saved.Data.Version+`"}`)
	require.Equal(t, http.StatusOK, status, "the answered version saves the same day again: %s", body)

	status, body = send(http.MethodPut, path, `{"dishes":[],"expected_version":"`+read().Version+`"}`)
	require.Equal(t, http.StatusOK, status, "an empty list clears the day against its current version: %s", body)
	assert.Empty(t, read().Dishes)
}
