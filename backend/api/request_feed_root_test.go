package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/api/testutil"
	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// checkRequestFeedControls drives the staff's controls of the parent request
// feed through the production router: they answer in the shared envelope
// (#2352), the status never carries the link, and replacing the link keeps
// the feed active.
func checkRequestFeedControls(t *testing.T, graph *goldenRuntime) {
	t.Parallel()

	db := testpkg.SetupTestDB(t)
	tenantID := testpkg.Tenant(t)
	account := testpkg.CreateTestAccount(t, db, fmt.Sprintf("request-feed-root-%d@test.local", time.Now().UnixNano()))
	admin := testpkg.GetOrCreateTestRole(t, db, "admin")
	_, err := db.ExecContext(testpkg.Ctx(t), `INSERT INTO auth.account_roles (tenant_id, account_id, role_id) VALUES (?, ?, ?)`, tenantID, account.ID, admin.ID)
	require.NoError(t, err)
	token := testpkg.MintLiveSessionJWT(t, db, testutil.AdminTestClaimsForTenant(int(account.ID), tenantID))
	const path = "/api/students/change-requests/rss-feed"

	status := func() bool {
		t.Helper()
		rec := checkpointRequest(graph, checkpointScenario{Method: http.MethodGet, Path: path, Authenticated: true}, token)
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		assert.NotContains(t, rec.Body.String(), "url", "the status never carries the link")
		var body struct {
			Status string `json:"status"`
			Data   struct {
				Active bool `json:"active"`
			} `json:"data"`
		}
		require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
		assert.Equal(t, "success", body.Status)
		return body.Data.Active
	}
	feedURL := func(method, path string, want int) string {
		t.Helper()
		rec := checkpointRequest(graph, checkpointScenario{Method: method, Path: path, Authenticated: true}, token)
		require.Equal(t, want, rec.Code, rec.Body.String())
		var body struct {
			Status string `json:"status"`
			Data   struct {
				URL string `json:"url"`
			} `json:"data"`
		}
		require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
		assert.Equal(t, "success", body.Status)
		assert.Contains(t, body.Data.URL, "/api/request-feed/", "the link names the token route")
		return body.Data.URL
	}

	assert.False(t, status(), "no feed before it is created")
	created := feedURL(http.MethodPost, path, http.StatusCreated)
	assert.True(t, status(), "the created feed is active")
	rotated := feedURL(http.MethodPost, path+"/rotate", http.StatusOK)
	assert.NotEqual(t, created, rotated, "rotating replaces the link")
	assert.True(t, status(), "the replaced link keeps the feed active")
}
