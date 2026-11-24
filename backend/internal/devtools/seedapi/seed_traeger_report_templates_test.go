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

func TestSeedTraegerReportTemplatesStepAddsTheMissingTemplates(t *testing.T) {
	t.Parallel()

	var mu sync.Mutex
	var calls []string
	var created []map[string]any
	srv := newSeedHTTPTestServer(func(w seedHTTPResponseWriter, r *seedHTTPRequest) {
		mu.Lock()
		defer mu.Unlock()
		calls = append(calls, r.Method+" "+r.URL.Path)
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.URL.Path == "/traeger/auth/login":
			_, _ = w.Write([]byte(`{"status":"authenticated","access_token":"traeger-token","refresh_token":"r"}`))
		case r.URL.Path == "/traeger/schools/":
			_, _ = w.Write([]byte(`{"status":"success","data":[{"id":11},{"id":12},{"id":13}]}`))
		case r.URL.Path == "/traeger/report-templates/" && r.Method == http.MethodGet:
			// Another demo school already saved the Kommune template.
			_, _ = w.Write([]byte(`{"status":"success","data":[{"id":1,"name":"Kommune Belegung und Nachfrage"}]}`))
		default:
			assert.Equal(t, "Bearer traeger-token", r.Header.Get("Authorization"))
			body, _ := io.ReadAll(r.Body)
			var template map[string]any
			assert.NoError(t, json.Unmarshal(body, &template))
			created = append(created, template)
			w.WriteHeader(http.StatusCreated)
			_, _ = w.Write([]byte(`{"status":"success"}`))
		}
	})
	defer srv.Close()

	runtime := &Runtime{
		Client:    newTestClient(srv.URL, false),
		Bootstrap: &bootstrapSeedState{AdminEmail: "admin@example.test", AdminPassword: testpkg.NewTestPassword()},
	}
	require.NoError(t, (seedTraegerReportTemplatesStep{}).Run(context.Background(), runtime))
	assert.Equal(t, []string{"POST /traeger/auth/login", "GET /traeger/schools/", "GET /traeger/report-templates/", "POST /traeger/report-templates/"}, calls,
		"only the missing template is added")
	require.Len(t, created, 1)
	assert.Equal(t, "Jugendamt Stichtag 15.10.", created[0]["name"])
	assert.Equal(t, []any{"children", "staff", "absences", "demand"}, created[0]["sections"])
	assert.Equal(t, []any{
		map[string]any{"school_id": "11", "district": "Nord"},
		map[string]any{"school_id": "12", "district": "Süd"},
		map[string]any{"school_id": "13", "district": "Nord"},
	}, created[0]["districts"], "the schools in two Sozialräume")
}
