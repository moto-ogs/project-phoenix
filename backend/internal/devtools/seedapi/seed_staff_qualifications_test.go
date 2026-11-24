package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestSeedStaffQualificationsUsesStringQualificationTypeIDs(t *testing.T) {
	t.Parallel()

	const firstAidID = "9007199254740993"
	const certificateID = "9007199254740994"
	const hygieneID = "9007199254740995"
	var qualificationTypeIDs []string
	var sentVersions []any
	var kindVersion any

	srv := newSeedHTTPTestServer(func(w seedHTTPResponseWriter, r *seedHTTPRequest) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/api/staff/qualification-types":
			_, _ = fmt.Fprint(w, `{"data":[{"id":"9007199254740993","standard_key":"first_aid_child","name":"Erste Hilfe am Kind","validity_months":24},{"id":"9007199254740994","standard_key":"extended_police_certificate","name":"Erweitertes Führungszeugnis","validity_months":60,"version":"kind-read"}]}`)
		case r.Method == http.MethodPut && r.URL.Path == "/api/staff/qualification-types/"+certificateID:
			var body struct {
				ExpectedVersion any `json:"expected_version"`
			}
			require.NoError(t, json.NewDecoder(r.Body).Decode(&body))
			kindVersion = body.ExpectedVersion
			_, _ = fmt.Fprint(w, `{"data":{}}`)
		case r.Method == http.MethodPost && r.URL.Path == "/api/staff/qualification-types":
			_, _ = fmt.Fprintf(w, `{"data":{"id":"%s","name":"Hygieneschulung","validity_months":12}}`, hygieneID)
		case r.Method == http.MethodGet && strings.HasSuffix(r.URL.Path, "/stammdaten"):
			_, _ = fmt.Fprintf(w, `{"data":{"versions":{"qualifikationen":"read-%s"}}}`, strings.Split(r.URL.Path, "/")[3])
		case r.Method == http.MethodPut && strings.HasSuffix(r.URL.Path, "/stammdaten/qualifikationen"):
			var body struct {
				Qualifications []struct {
					TypeID *string `json:"type_id"`
				} `json:"qualifikationen"`
				ExpectedVersion any `json:"expected_version"`
			}
			require.NoError(t, json.NewDecoder(r.Body).Decode(&body))
			sentVersions = append(sentVersions, body.ExpectedVersion)
			for _, qualification := range body.Qualifications {
				if qualification.TypeID != nil {
					qualificationTypeIDs = append(qualificationTypeIDs, *qualification.TypeID)
				}
			}
			_, _ = fmt.Fprint(w, `{"data":{}}`)
		default:
			t.Fatalf("unexpected request %s %s", r.Method, r.URL.Path)
		}
	})
	defer srv.Close()

	fs := NewFixedSeeder(newTestClient(srv.URL, false), false, "")
	fs.staffIDs = map[string]int64{}
	for index, staff := range DemoStaff[:6] {
		fs.staffIDs[fmt.Sprintf("%s %s", staff.FirstName, staff.LastName)] = int64(index + 1)
	}
	require.NoError(t, (seedStaffQualificationsStep{}).Run(t.Context(), &Runtime{
		Client: fs.client, FixedSeeder: fs, TenantAuth: AuthRef{Kind: AuthBearer, Token: "admin"},
	}))

	assert.Equal(t, []string{
		firstAidID, certificateID, firstAidID, certificateID, hygieneID,
		firstAidID, certificateID, firstAidID, certificateID, firstAidID,
	}, qualificationTypeIDs)
	// Each list carries the version of the staff member's read (ADR 0311):
	// without it the route refuses the save and the demo seed stops.
	assert.Equal(t, []any{"read-1", "read-2", "read-3", "read-4", "read-5", "read-6"}, sentVersions)
	assert.Equal(t, "kind-read", kindVersion, "the kind is marked mandatory over the version the list answered (ADR 0311)")
}
