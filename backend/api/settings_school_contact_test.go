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
