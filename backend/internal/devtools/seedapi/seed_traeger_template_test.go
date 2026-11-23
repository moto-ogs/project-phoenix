package api

import (
	"encoding/json"
	"fmt"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// A save refused as changed since the read is read again once (ADR 0311):
// the seeder saves over the new version while the template is still the
// standard one, instead of counting the refusal as a save.
func TestSeedTraegerTemplateReadsAgainAfterAChangedRefusal(t *testing.T) {
	t.Parallel()
	reads := 0
	var saved []string
	srv := newSeedHTTPTestServer(func(w seedHTTPResponseWriter, r *seedHTTPRequest) {
		w.Header().Set("Content-Type", "application/json")
		switch r.Method + " " + r.URL.Path {
		case "GET /traeger/master-data/document-templates/bestaetigung":
			reads++
			_, _ = fmt.Fprintf(w, `{"status":"success","data":{"version":"v%d","current":{"standard":true}}}`, reads)
		case "POST /traeger/master-data/document-templates/bestaetigung/versions":
			var body struct {
				ExpectedVersion string `json:"expected_version"`
			}
			require.NoError(t, json.NewDecoder(r.Body).Decode(&body))
			saved = append(saved, body.ExpectedVersion)
			if body.ExpectedVersion == "v1" {
				w.Header().Set("Content-Type", "application/problem+json")
				w.WriteHeader(409)
				_, _ = fmt.Fprint(w, `{"status":409,"code":"general.changed_since_read","detail":"changed since it was read"}`)
				return
			}
			_, _ = fmt.Fprint(w, `{"status":"success","data":{}}`)
		default:
			t.Errorf("unexpected request %s %s", r.Method, r.URL.Path)
		}
	})
	defer srv.Close()

	require.NoError(t, seedTraegerLetterTemplateOnce(newTestClient(srv.URL, false), AuthRef{Kind: AuthBearer, Token: "traeger"}))
	assert.Equal(t, []string{"v1", "v2"}, saved, "the second save carries the version read after the refusal")
}
