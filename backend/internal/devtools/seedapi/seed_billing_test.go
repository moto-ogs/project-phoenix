package api

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// The step captures the snapshot through the bound billing report (ADR 0298)
// and gives the profile's Träger and school their own key day (#7301).
func TestSeedBillingKeyDateCountsStepCapturesThroughTheBoundReport(t *testing.T) {
	t.Parallel()

	var calls []string
	srv := newSeedHTTPTestServer(func(w seedHTTPResponseWriter, r *seedHTTPRequest) {
		calls = append(calls, r.Method+" "+r.URL.Path)
		assert.Equal(t, "Bearer operator-token", r.Header.Get("Authorization"))
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":"success","data":{}}`))
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
	captures := 0
	step := seedBillingKeyDateCountsStep{seeder: &Seeder{options: SeedOptions{BillingKeyDateCounts: func(context.Context) (int, error) {
		captures++
		return 1, nil
	}}}}

	require.NoError(t, step.Run(context.Background(), runtime))
	assert.Equal(t, 1, captures)
	assert.Equal(t, tenantAuth, client.auth)
	assert.Equal(t, []string{
		"PUT /operator/billing/key-day-overrides/organizations/4",
		"PUT /operator/billing/key-day-overrides/schools/9",
	}, calls)

	// The public demo binds no report: the own key days still follow.
	calls = nil
	require.NoError(t, seedBillingKeyDateCountsStep{seeder: &Seeder{}}.Run(context.Background(), runtime))
	assert.Len(t, calls, 2)
}
