package api

import (
	"context"
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestSeedBillingKeyDateCountsStepUsesTheLocalOperatorRoute(t *testing.T) {
	t.Parallel()

	var authorization, seedHeader string
	var calls []string
	srv := newSeedHTTPTestServer(func(w seedHTTPResponseWriter, r *seedHTTPRequest) {
		calls = append(calls, r.Method+" "+r.URL.Path)
		if r.Method == http.MethodPost {
			authorization = r.Header.Get("Authorization")
			seedHeader = r.Header.Get(seedTokenHeader)
		} else {
			assert.Equal(t, "Bearer operator-token", r.Header.Get("Authorization"))
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":"success","data":{"written":1}}`))
	})
	defer srv.Close()

	client := newTestClient(srv.URL, false)
	tenantAuth := AuthRef{Kind: AuthBearer, Token: "tenant-token"}
	client.BindAuth(tenantAuth)
	runtime := &Runtime{
		Client:       client,
		OperatorAuth: AuthRef{Kind: AuthBearer, Token: "operator-token"},
		Bootstrap:    &bootstrapSeedState{OrganizationID: 4, SchoolID: 9},
	}

	require.NoError(t, (seedBillingKeyDateCountsStep{}).Run(context.Background(), runtime))
	assert.Equal(t, "Bearer operator-token", authorization)
	assert.Equal(t, "true", seedHeader)
	assert.Equal(t, tenantAuth, client.auth)
	// #7301: the profile's Träger and school get their own key day.
	assert.Equal(t, []string{
		"POST /operator/billing/key-date-counts/seed",
		"PUT /operator/billing/key-day-overrides/organizations/4",
		"PUT /operator/billing/key-day-overrides/schools/9",
	}, calls)
}
