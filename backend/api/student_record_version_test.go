package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	testpkg "github.com/moto-ogs/project-phoenix/test"
	"github.com/stretchr/testify/require"
)

// checkStudentFormSavesTheVersionItsDetailRead pins the pairing of ADR 0311
// across two owners: Presence Projection's child detail hands out the version
// the edit form saves against, and Care Plan's update compares it under the
// child's row lock. Both must digest the same stored state the same way.
func checkStudentFormSavesTheVersionItsDetailRead(t *testing.T, runtime *goldenRuntime) {
	testpkg.OwnTenant(t)
	db := testpkg.SetupTestDB(t)
	_, account := testpkg.CreateTestTeacherWithAccount(t, db, "Version", "Editor")
	token := testpkg.MintLiveSessionJWT(t, db, testpkg.AdminTestClaims(int(account.ID)))
	child := testpkg.CreateTestStudent(t, db, "Version", "Child", "VC1")
	send := func(method, body string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, fmt.Sprintf("http://localhost/api/students/%d", child.ID), strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer "+token)
		rr := httptest.NewRecorder()
		runtime.ServeHTTP(rr, req)
		return rr
	}
	read := send(http.MethodGet, "")
	require.Equal(t, http.StatusOK, read.Code, read.Body.String())
	var detail struct {
		Data struct {
			Version string `json:"version"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(read.Body.Bytes(), &detail))
	require.NotEmpty(t, detail.Data.Version)

	saved := send(http.MethodPut, fmt.Sprintf(`{"expected_version":%q,"extra_info":"Erste Fassung"}`, detail.Data.Version))
	require.Equal(t, http.StatusOK, saved.Code, saved.Body.String())
	again := send(http.MethodPut, fmt.Sprintf(`{"expected_version":%q,"extra_info":"Zweite Fassung"}`, detail.Data.Version))
	require.Equal(t, http.StatusConflict, again.Code, again.Body.String())
	require.Contains(t, again.Body.String(), `"code":"general.changed_since_read"`)
}
