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

// Switching the online enrollment on prefills the notification recipients
// with the school's contact address (#7176). The settings route answers it
// from the school's master data of its own tenant.
func TestSettingsSchoolContactEmailAnswersTheOwnSchool(t *testing.T) {
	t.Parallel()
	testpkg.OwnTenant(t)
	db := testpkg.SetupTestDB(t)
	_, err := db.NewRaw("UPDATE platform.schools SET email = ? WHERE id = ?", "kontakt@schule.example", testpkg.Tenant(t)).Exec(testpkg.Ctx(t))
	require.NoError(t, err)
	route := setupSettingsCallbackRoute(t)

	req := testutil.NewAuthenticatedRequest(t, http.MethodGet, "/school-contact-email", nil,
		testutil.WithJWTBearer(testutil.MintTestJWT(t, adminClaimsForCallback())))
	rr := testutil.ExecuteRequest(route.router, req)

	require.Equal(t, http.StatusOK, rr.Code, rr.Body.String())
	var body struct {
		Data struct {
			Email string `json:"email"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(rr.Body.Bytes(), &body))
	assert.Equal(t, "kontakt@schule.example", body.Data.Email)
}

// The settings page reveals a stored value through its production path
// (#2352): the answer carries the value the school saved.
func TestSettingsRevealValueAnswersTheStoredValue(t *testing.T) {
	t.Parallel()
	testpkg.OwnTenant(t)
	route := setupSettingsCallbackRoute(t)
	router := testpkg.MountedQueryBudgetRouter("/api/settings", route.router)
	key := "/values/operations.student_daily_checkout_time"
	token := testutil.WithJWTBearer(testutil.MintTestJWT(t, adminClaimsForCallback()))

	rr := testutil.ExecuteRequest(router, testutil.NewAuthenticatedRequest(t, http.MethodPut, key, map[string]any{"value": "17:45"}, token))
	require.Equal(t, http.StatusOK, rr.Code, rr.Body.String())

	rr = testutil.ExecuteRequest(router, testutil.NewAuthenticatedRequest(t, http.MethodGet, key+"/reveal", nil, token))
	require.Equal(t, http.StatusOK, rr.Code, rr.Body.String())
	var body struct {
		Data struct {
			Value string `json:"value"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(rr.Body.Bytes(), &body))
	assert.Equal(t, "17:45", body.Data.Value)
}
