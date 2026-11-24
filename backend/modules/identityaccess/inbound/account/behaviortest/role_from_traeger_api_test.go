package account_test

import (
	"encoding/json"
	"fmt"
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	authAPI "github.com/moto-ogs/project-phoenix/modules/identityaccess/inbound/account"
)

// A role the school's Träger gives (#4810, ADR 0317) over the school's own
// routes: the list marks it, and the school changes neither its master data
// nor its permissions nor deletes it. Each refusal answers 403 with the code
// the role page explains.
func TestSchoolRoutesRefuseToChangeARoleOfTheTraeger(t *testing.T) {
	t.Parallel()
	e := newAccountIsolationEnv(t)
	own := e.createRole(t, map[string]string{"name": fmt.Sprintf("Kopie %d", e.tenantID), "template": "user"})
	_, err := e.tc.db.ExecContext(t.Context(), `UPDATE auth.roles SET traeger_role_id = 4810 WHERE id = ?`, own.ID.Int64())
	require.NoError(t, err)

	rr := e.execute(t, e.claims, http.MethodGet, fmt.Sprintf("/auth/roles/%d/", own.ID.Int64()), nil)
	require.Equal(t, http.StatusOK, rr.Code, rr.Body.String())
	var read struct {
		Data authAPI.RoleResponse `json:"data"`
	}
	require.NoError(t, json.Unmarshal(rr.Body.Bytes(), &read))
	assert.True(t, read.Data.FromTraeger)

	path := fmt.Sprintf("/auth/roles/%d", own.ID.Int64())
	for name, attempt := range map[string]func() int{
		"master data": func() int {
			return e.refusal(t, http.MethodPut, path+"/master-data/", map[string]any{"name": "Eigener Name", "expected_version": read.Data.Version})
		},
		"permissions": func() int {
			return e.refusal(t, http.MethodPut, path+"/permission-selection/", map[string]any{"permission_ids": []string{}, "expected_version": "x"})
		},
		"deletion": func() int { return e.refusal(t, http.MethodDelete, path+"/", nil) },
	} {
		assert.Equal(t, http.StatusForbidden, attempt(), name)
	}
	assert.NotEmpty(t, e.permissionNamesOf(t, own.ID.Int64()), "the role keeps its permissions")
}

// refusal sends the request and returns its status after checking that a
// refusal carries the code of a Träger role.
func (e *accountIsolationEnv) refusal(t *testing.T, method, path string, body any) int {
	t.Helper()
	rr := e.execute(t, e.claims, method, path, body)
	var problem struct {
		Code string `json:"code"`
	}
	require.NoError(t, json.Unmarshal(rr.Body.Bytes(), &problem), rr.Body.String())
	assert.Equal(t, "identity.role_from_traeger", problem.Code, rr.Body.String())
	return rr.Code
}
