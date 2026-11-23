package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/api/testutil"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// The School Membership half of /api/staff answers through the composed
// router under its production path: the Klassen tab replaces and reads the
// assignments, and the documents and financial tabs identify the person.
func TestStaffMembershipRoutesAnswerUnderTheProductionPath(t *testing.T) {
	t.Parallel()
	ctx := setupStaffCompositionRoute(t)
	router := testpkg.MountedQueryBudgetRouter("/api", ctx.router)
	_, accountID := ctx.createStaffWithAccount("Leitung", "Klassen")
	staffID, _ := ctx.createStaff("Lehrkraft", "Zuordnung")
	token := func(perms ...string) testutil.RequestOption {
		claims := testutil.DefaultTestClaims()
		claims.ID = int(accountID)
		claims.Permissions = perms
		return testutil.WithJWTBearer(testutil.MintTestJWT(t, claims))
	}
	call := func(method, path string, body any, auth testutil.RequestOption) map[string]any {
		t.Helper()
		rr := testutil.ExecuteRequest(router, testutil.NewAuthenticatedRequest(t, method, path, body, auth))
		require.Equal(t, http.StatusOK, rr.Code, rr.Body.String())
		var envelope struct {
			Data map[string]any `json:"data"`
		}
		require.NoError(t, json.Unmarshal(rr.Body.Bytes(), &envelope))
		return envelope.Data
	}
	classes := fmt.Sprintf("/staff/%d/school-classes", staffID)

	shown := call(http.MethodGet, classes, nil, token("users:read"))
	written := call(http.MethodPut, classes, map[string]any{"school_classes": []string{"2b", "1a"}, "expected_version": shown["version"]}, token("users:manage"))
	assert.ElementsMatch(t, []any{"1a", "2b"}, written["school_classes"])
	read := call(http.MethodGet, classes, nil, token("users:read"))
	assert.ElementsMatch(t, []any{"1a", "2b"}, read["school_classes"], "the read shows the stored assignment")
	assert.EqualValues(t, staffID, testpkg.JSONID(t, read["staff_id"]))
	assert.Equal(t, written["version"], read["version"], "the save answers the token of what it stored")

	// A save on the assignments read before that save is refused (ADR 0311)
	// and writes nothing.
	stale := testutil.ExecuteRequest(router, testutil.NewAuthenticatedRequest(t, http.MethodPut, classes,
		map[string]any{"school_classes": []string{"3c"}, "expected_version": shown["version"]}, token("users:manage")))
	require.Equal(t, http.StatusConflict, stale.Code, stale.Body.String())
	assert.Contains(t, stale.Body.String(), "general.changed_since_read")
	assert.ElementsMatch(t, []any{"1a", "2b"}, call(http.MethodGet, classes, nil, token("users:read"))["school_classes"])

	for path, permission := range map[string]string{
		fmt.Sprintf("/staff/documents-profile/%d", staffID): "staff:documents",
		fmt.Sprintf("/staff/financial-profile/%d", staffID): "staff:financial",
	} {
		profile := call(http.MethodGet, path, nil, token(permission))
		assert.Equal(t, "Lehrkraft Zuordnung", profile["name"], path)
		assert.EqualValues(t, staffID, testpkg.JSONID(t, profile["id"]), path)
		assert.NotContains(t, profile, "ended_on", "a current staff member carries no employment period")
	}
}
