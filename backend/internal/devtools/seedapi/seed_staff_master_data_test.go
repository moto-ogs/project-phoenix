package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// The contact section carries the version of the read it replaces
// (ADR 0311); without it the route refuses the save and the demo seed stops.
func TestSeedStaffMasterDataSendsTheReadVersion(t *testing.T) {
	t.Parallel()

	var sent map[string]any
	srv := newSeedHTTPTestServer(func(w seedHTTPResponseWriter, r *seedHTTPRequest) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/api/staff/1/stammdaten":
			_, _ = fmt.Fprint(w, `{"data":{"versions":{"kontakt":"read-kontakt"}}}`)
		case r.Method == http.MethodPut && r.URL.Path == "/api/staff/1/stammdaten/kontakt":
			require.NoError(t, json.NewDecoder(r.Body).Decode(&sent))
			_, _ = fmt.Fprint(w, `{"data":{}}`)
		default:
			t.Fatalf("unexpected request %s %s", r.Method, r.URL.Path)
		}
	})
	defer srv.Close()

	fs := NewFixedSeeder(newTestClient(srv.URL, false), false, "")
	staff := DemoStaff[0]
	fs.staffIDs = map[string]int64{fmt.Sprintf("%s %s", staff.FirstName, staff.LastName): 1}
	require.NoError(t, (seedStaffMasterDataStep{}).Run(t.Context(), &Runtime{
		Client: fs.client, FixedSeeder: fs, TenantAuth: AuthRef{Kind: AuthBearer, Token: "admin"},
	}))

	assert.Equal(t, "read-kontakt", sent["expected_version"])
	assert.Equal(t, "Musterweg 12", sent["address_street"])
}
