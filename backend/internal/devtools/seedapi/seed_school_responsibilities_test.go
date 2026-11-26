package api

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"sync"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	testpkg "github.com/moto-ogs/project-phoenix/test"
)

// responsibilitySeedServer answers the routes of the step; stored says
// whether school 42 already has its Gemeinde.
func responsibilitySeedServer(t *testing.T, stored bool, calls *[]string, bodies *[]map[string]any) *testpkg.HTTPTestServer {
	t.Helper()
	var mu sync.Mutex
	return newSeedHTTPTestServer(func(w seedHTTPResponseWriter, r *seedHTTPRequest) {
		mu.Lock()
		defer mu.Unlock()
		*calls = append(*calls, r.Method+" "+r.URL.Path)
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.URL.Path == "/traeger/auth/login":
			_, _ = w.Write([]byte(`{"status":"authenticated","access_token":"traeger-token","refresh_token":"r"}`))
		case r.Method == http.MethodGet:
			parties := `[]`
			if stored {
				parties = `[{"kind":"gemeinde"}]`
			}
			_, _ = w.Write([]byte(`{"status":"success","data":{"schools":[{"school_id":"41","parties":[{"kind":"gemeinde"}]},{"school_id":"42","parties":` + parties + `}]}}`))
		default:
			raw, _ := io.ReadAll(r.Body)
			var body map[string]any
			assert.NoError(t, json.Unmarshal(raw, &body))
			body["authorization"] = r.Header.Get("Authorization")
			*bodies = append(*bodies, body)
			_, _ = w.Write([]byte(`{"status":"success"}`))
		}
	})
}

func responsibilitySeedRuntime(url string) *Runtime {
	return &Runtime{
		Client:       newTestClient(url, false),
		Bootstrap:    &bootstrapSeedState{AdminEmail: "admin@example.test", AdminPassword: testpkg.NewTestPassword(), SchoolID: 42},
		OperatorAuth: AuthRef{Kind: AuthBearer, Token: "operator-token"},
	}
}

func TestSeedSchoolResponsibilitiesStepStoresTheGemeindeOfItsSchool(t *testing.T) {
	t.Parallel()
	var calls []string
	var bodies []map[string]any
	srv := responsibilitySeedServer(t, false, &calls, &bodies)
	defer srv.Close()

	require.NoError(t, (seedSchoolResponsibilitiesStep{}).Run(context.Background(), responsibilitySeedRuntime(srv.URL)))
	assert.Equal(t, []string{
		"POST /traeger/auth/login", "GET /traeger/master-data/responsibilities",
		"PUT /traeger/master-data/responsibilities/schools/42/parties/gemeinde",
		"PUT /operator/schools/42/settings/values/responsibility.staff",
	}, calls)
	require.Len(t, bodies, 2)
	assert.Equal(t, "Gemeinde Bissendorf", bodies[0]["name"])
	assert.Equal(t, "", bodies[0]["expected_version"], "a new body carries no version")
	assert.Equal(t, "Bearer traeger-token", bodies[0]["authorization"], "the Träger-Büro stores the body")
	assert.Equal(t, "gemeinde", bodies[1]["value"])
	assert.Equal(t, "Bearer operator-token", bodies[1]["authorization"], "the school's own value goes through the operator route")
}

func TestSeedSchoolResponsibilitiesStepKeepsAStoredGemeinde(t *testing.T) {
	t.Parallel()
	var calls []string
	var bodies []map[string]any
	srv := responsibilitySeedServer(t, true, &calls, &bodies)
	defer srv.Close()

	require.NoError(t, (seedSchoolResponsibilitiesStep{}).Run(context.Background(), responsibilitySeedRuntime(srv.URL)))
	assert.Equal(t, []string{
		"POST /traeger/auth/login", "GET /traeger/master-data/responsibilities",
		"PUT /operator/schools/42/settings/values/responsibility.staff",
	}, calls, "a seed that runs again writes no second body")
}

// TestSeedGemeindeBillingStepLetsTheGemeindeOfTheManualSchoolBill (#8040):
// the Gemeinde of the second school gets its creditor identifier and
// account, the school's own value „Gemeinde“ for billing and number ranges
// of its own; the seeded school keeps the Träger.
func TestSeedGemeindeBillingStepLetsTheGemeindeOfTheManualSchoolBill(t *testing.T) {
	t.Parallel()
	var calls []string
	var bodies []map[string]any
	srv := responsibilitySeedServer(t, false, &calls, &bodies)
	defer srv.Close()
	rt := responsibilitySeedRuntime(srv.URL)
	rt.Bootstrap.OrganizationID = 7
	rt.AdditionalProfiles = map[string]*SeedProfile{ManualProfileKey: {Organization: SeedOrganizationRef{ID: 7}, School: SeedSchoolRef{ID: 42}}}

	require.NoError(t, (seedGemeindeBillingStep{}).Run(context.Background(), rt))
	assert.Equal(t, []string{
		"POST /traeger/auth/login", "GET /traeger/master-data/responsibilities",
		"PUT /traeger/master-data/responsibilities/schools/42/parties/gemeinde",
		"PUT /operator/schools/42/settings/values/responsibility.billing",
		"PUT /traeger/number-ranges/holiday", "PUT /traeger/number-ranges/care",
	}, calls)
	require.Len(t, bodies, 4)
	assert.Equal(t, seedBillingGemeindeCreditor, bodies[0]["creditor_id"])
	assert.NotEqual(t, seedSchoolGemeinde["creditor_id"], bodies[0]["creditor_id"], "a creditor identifier of its own")
	assert.Equal(t, "gemeinde", bodies[1]["value"])
	assert.Equal(t, seedBillingGemeindeCreditor, bodies[2]["issuer_key"])
	assert.Equal(t, "WH-B-{JJJJ}-{NNNN}", bodies[3]["pattern"])
}

// Without a second school of the Träger the step leaves every school with
// the Träger.
func TestSeedGemeindeBillingStepNeedsASecondSchool(t *testing.T) {
	t.Parallel()
	var calls []string
	var bodies []map[string]any
	srv := responsibilitySeedServer(t, false, &calls, &bodies)
	defer srv.Close()
	require.NoError(t, (seedGemeindeBillingStep{}).Run(context.Background(), responsibilitySeedRuntime(srv.URL)))
	assert.Empty(t, calls)
}
