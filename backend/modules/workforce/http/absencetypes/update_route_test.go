//go:build testhooks

package absencetypes_test

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/api"
	"github.com/moto-ogs/project-phoenix/api/testutil"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// A school renames and retires its own Abwesenheitsart through the route
// under its production path (#2352); the list shows the stored state.
func TestAbsenceTypeUpdateRenamesAndRetiresTheType(t *testing.T) {
	t.Parallel()
	db := testpkg.SetupTestDB(t)
	module, caller, err := api.NewAbsenceTypeTestModule(testpkg.NewDatabase(t, db))
	require.NoError(t, err)
	router := chi.NewRouter()
	router.Mount("/api/absence-types", api.NewAbsenceTypesRouterForBudgetTest(module.Administration, caller.Caller().StaffID))
	claims := testutil.DefaultTestClaims()
	claims.TenantID = testpkg.Tenant(t)
	claims.IsAdmin = false
	claims.Permissions = []string{"time_tracking:manage"}
	auth := testutil.WithJWTBearer(testutil.MintTestJWT(t, claims))
	type absenceType struct {
		ID       string `json:"id"`
		Name     string `json:"name"`
		IsActive bool   `json:"is_active"`
	}
	send := func(method, path string, body any, status int) []byte {
		t.Helper()
		response := testutil.ExecuteRequestForTest(t, router, testutil.NewAuthenticatedRequest(t, method, path, body, auth))
		require.Equal(t, status, response.Code, response.Body.String())
		return response.Body.Bytes()
	}
	decode := func(raw []byte, into any) {
		t.Helper()
		envelope := struct {
			Data any `json:"data"`
		}{Data: into}
		require.NoError(t, json.Unmarshal(raw, &envelope))
	}

	var created absenceType
	decode(send(http.MethodPost, "/api/absence-types/", map[string]any{"name": "Hospitation"}, http.StatusCreated), &created)
	var updated absenceType
	decode(send(http.MethodPut, "/api/absence-types/"+created.ID, map[string]any{"name": "Hospitation extern", "is_active": false}, http.StatusOK), &updated)
	assert.Equal(t, absenceType{ID: created.ID, Name: "Hospitation extern", IsActive: false}, updated)

	var listed []absenceType
	decode(send(http.MethodGet, "/api/absence-types/", nil, http.StatusOK), &listed)
	assert.Contains(t, listed, updated, "the list shows the renamed, retired type")
}
