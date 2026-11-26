package api

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestSeedCareContractChangeUsesContractChild(t *testing.T) {
	t.Parallel()
	for _, student := range []string{"22", "null", "99"} {
		t.Run(student, func(t *testing.T) {
			var catalogs, requests []string
			srv := newSeedHTTPTestServer(func(w seedHTTPResponseWriter, r *seedHTTPRequest) {
				w.Header().Set("Content-Type", "application/json")
				switch {
				case r.URL.Path == "/traeger/contracts/":
					_, _ = fmt.Fprintf(w, `{"data":{"contracts":[{"id":70,"party_email":"parent@example.test","student_id":%s}]}}`, student)
				case r.URL.Path == "/parent/auth/login":
					_, _ = fmt.Fprint(w, `{"access_token":"parent-token"}`)
				case strings.HasSuffix(r.URL.Path, "/catalog"):
					catalogs = append(catalogs, r.URL.Path)
					_, _ = fmt.Fprint(w, `{"data":{"earliest_effective_from":"2026-12-01","items":[{"id":"80","selected":true,"days_of_week_mode":"parent_choice","selected_days":["mon","tue"]}]}}`)
				case strings.HasSuffix(r.URL.Path, "/requests"):
					requests = append(requests, r.URL.Path)
					_, _ = fmt.Fprint(w, `{"data":{}}`)
				default:
					t.Errorf("unexpected request: %s", r.URL.Path)
				}
			})
			defer srv.Close()
			rt := &Runtime{Client: newTestClient(srv.URL, false), Parents: []ParentCredentials{{Email: "parent@example.test", Password: "example-test-password", StudentIDs: []int64{11, 22}}}}
			changed, err := seedCareContractChange(rt, AuthRef{})
			require.NoError(t, err)
			if student == "22" {
				assert.True(t, changed)
				assert.Equal(t, []string{"/parent/me/children/22/care-offerings/catalog"}, catalogs)
				assert.Equal(t, []string{"/parent/me/children/22/care-offerings/requests"}, requests)
			} else {
				assert.False(t, changed)
				assert.Empty(t, catalogs)
				assert.Empty(t, requests)
			}
		})
	}
}

// TestSeedCareContractSchoolChangeTakesOneDayOffAContractChild pins the seed
// of #4816: the school books the child of an active contract again without
// the last chosen weekday of its care, so the contract gets a version that
// waits for the parents' signature. A contract whose change waits already
// is left alone.
func TestSeedCareContractSchoolChangeTakesOneDayOffAContractChild(t *testing.T) {
	t.Parallel()
	for name, waits := range map[string]bool{"a contract without a change": false, "a change waits already": true} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			var put []string
			var body map[string]any
			srv := newSeedHTTPTestServer(func(w seedHTTPResponseWriter, r *seedHTTPRequest) {
				w.Header().Set("Content-Type", "application/json")
				switch r.URL.Path {
				case "/traeger/contracts/":
					_, _ = fmt.Fprintf(w, `{"data":{"contracts":[{"request_child_id":"38","student_id":"6","change_awaits_signature":%t}]}}`, waits)
				case "/api/enrollment/admin/students/6/requests":
					_, _ = fmt.Fprint(w, `{"data":[{"id":"31"}]}`)
				case "/api/enrollment/admin/requests/31":
					_, _ = fmt.Fprint(w, `{"data":{"children":[{"id":"38","offerings_version":"v1","offerings":[
						{"offering_id":"1","selected_days":["mon","wed","fri"]},{"offering_id":"3"}]}]}}`)
				case "/api/enrollment/admin/requests/31/children/38/offerings":
					put = append(put, r.Method)
					require.NoError(t, json.NewDecoder(r.Body).Decode(&body))
					_, _ = fmt.Fprint(w, `{"data":{}}`)
				default:
					t.Errorf("unexpected request: %s", r.URL.Path)
				}
			})
			defer srv.Close()
			rt := &Runtime{Client: newTestClient(srv.URL, false)}

			changed, err := seedCareContractSchoolChange(rt, AuthRef{})

			require.NoError(t, err)
			assert.Equal(t, !waits, changed)
			if waits {
				assert.Empty(t, put, "a second change would overtake the one that waits")
				return
			}
			require.Equal(t, []string{"PUT"}, put)
			assert.Equal(t, "v1", body["expected_version"])
			assert.Equal(t, []any{
				map[string]any{"offering_id": "1", "selected_days": []any{"mon", "wed"}},
				map[string]any{"offering_id": "3"},
			}, body["offerings"], "the first care with chosen days loses its last day; everything else stays")
		})
	}
}
