package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// seedRefuseChangedRun answers a command whose fingerprint is not the one
// of the last read as the run does after the worker concluded a contract.
func seedRefuseChangedRun(w seedHTTPResponseWriter, sent, current string) bool {
	if sent == current {
		return false
	}
	w.Header().Set("Content-Type", "application/problem+json")
	w.WriteHeader(http.StatusConflict)
	_, _ = fmt.Fprint(w, `{"status":409,"code":"parent_billing.billing_run_changed","detail":"changed"}`)
	return true
}

// The contract-conclusion worker concluded a contract between the read of
// the monthly run and the change of its first invoice (seed smoke,
// vollbetrieb: POST /traeger/care-billing-runs/3/amendments 409
// parent_billing.billing_run_changed, 70 s after the server start). The seed
// reads the run again and changes the invoice of that preview.
func TestSeedCareAmendmentReadsAChangedPreviewAgain(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct {
		name        string
		changes     int
		wantPosts   int
		wantRefusal bool
	}{
		{name: "worker concludes a contract", changes: 1, wantPosts: 2},
		{name: "changes never settle", changes: seedPreviewAttempts, wantPosts: seedPreviewAttempts, wantRefusal: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			reads, posts := 0, 0
			var sent []string
			srv := newSeedHTTPTestServer(func(w seedHTTPResponseWriter, r *seedHTTPRequest) {
				w.Header().Set("Content-Type", "application/json")
				switch r.Method + " " + r.URL.Path {
				case "GET /traeger/care-billing-runs/3":
					reads++
					_, _ = fmt.Fprintf(w, `{"data":{"id":3,"status":"calculated","fingerprint":"read-%d",
						"invoices":[{"contract_id":"11","service":"care","amendments":[]}]}}`, reads)
				case "POST /traeger/care-billing-runs/3/amendments":
					posts++
					var amendment struct {
						Fingerprint string `json:"fingerprint"`
					}
					if !assert.NoError(t, json.NewDecoder(r.Body).Decode(&amendment)) {
						return
					}
					sent = append(sent, amendment.Fingerprint)
					// The worker commits after each read until it is done.
					current := fmt.Sprintf("read-%d", reads)
					if posts <= tc.changes {
						current = "concluded"
					}
					if seedRefuseChangedRun(w, amendment.Fingerprint, current) {
						return
					}
					_, _ = fmt.Fprint(w, `{"data":{}}`)
				default:
					t.Errorf("unexpected request %s %s", r.Method, r.URL.Path)
				}
			})
			defer srv.Close()

			err := seedCareAmendment(newTestClient(srv.URL, false), AuthRef{Kind: AuthBearer, Token: "traeger"}, 3)
			assert.Equal(t, tc.wantPosts, posts)
			assert.Equal(t, tc.wantPosts, reads, "every change sends the preview read right before it")
			for i, fingerprint := range sent {
				assert.Equal(t, fmt.Sprintf("read-%d", i+1), fingerprint, "the seed never builds a fingerprint")
			}
			if tc.wantRefusal {
				require.Error(t, err)
				assert.True(t, seedConflictCode(err, seedCareRunChanged), "the last refusal stays visible: %v", err)
				return
			}
			require.NoError(t, err)
		})
	}
}

// A re-read run whose first invoice another seed changed meanwhile keeps
// that change: the retry changes nothing twice.
func TestSeedCareAmendmentKeepsAChangeTheRereadShows(t *testing.T) {
	t.Parallel()
	reads, posts := 0, 0
	srv := newSeedHTTPTestServer(func(w seedHTTPResponseWriter, r *seedHTTPRequest) {
		w.Header().Set("Content-Type", "application/json")
		switch r.Method + " " + r.URL.Path {
		case "GET /traeger/care-billing-runs/3":
			reads++
			amendments := `[]`
			if reads > 1 {
				amendments = `[{"kind":"add_position"}]`
			}
			_, _ = fmt.Fprintf(w, `{"data":{"id":3,"status":"calculated","fingerprint":"read-%d",
				"invoices":[{"contract_id":"11","service":"care","amendments":%s}]}}`, reads, amendments)
		case "POST /traeger/care-billing-runs/3/amendments":
			posts++
			seedRefuseChangedRun(w, "stale", "changed")
		default:
			t.Errorf("unexpected request %s %s", r.Method, r.URL.Path)
		}
	})
	defer srv.Close()

	require.NoError(t, seedCareAmendment(newTestClient(srv.URL, false), AuthRef{Kind: AuthBearer, Token: "traeger"}, 3))
	assert.Equal(t, 1, posts)
	assert.Equal(t, 2, reads)
}

// The release of the holiday run carries the fingerprint of the preview the
// corrections answered with. After a refusal because the run changed, the
// seed reads the run and releases that preview; another refusal is not
// retried.
func TestSeedHolidayRunReleasesAChangedPreviewAgain(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct {
		name      string
		refusal   string
		wantReads int
		wantError bool
	}{
		{name: "the run changed", refusal: "parent_billing.billing_run_changed", wantReads: 1},
		{name: "another conflict is not retried", refusal: "parent_billing.direct_debit_without_mandate", wantError: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			reads := 0
			var released []string
			srv := newSeedHTTPTestServer(func(w seedHTTPResponseWriter, r *seedHTTPRequest) {
				w.Header().Set("Content-Type", "application/json")
				switch r.Method + " " + r.URL.Path {
				case "GET /traeger/billing-runs/9":
					reads++
					_, _ = fmt.Fprint(w, `{"data":{"preview_count":3,"preview_cents":12000,"fingerprint":"reread"}}`)
				case "POST /traeger/billing-runs/9/release":
					var release struct {
						Count       int    `json:"document_count"`
						Fingerprint string `json:"fingerprint"`
					}
					if !assert.NoError(t, json.NewDecoder(r.Body).Decode(&release)) {
						return
					}
					released = append(released, release.Fingerprint)
					if len(released) == 1 {
						w.Header().Set("Content-Type", "application/problem+json")
						w.WriteHeader(http.StatusConflict)
						_, _ = fmt.Fprintf(w, `{"status":409,"code":%q,"detail":"refused"}`, tc.refusal)
						return
					}
					assert.Equal(t, 3, release.Count)
					_, _ = fmt.Fprint(w, `{"data":{"status":"released"}}`)
				default:
					t.Errorf("unexpected request %s %s", r.Method, r.URL.Path)
				}
			})
			defer srv.Close()

			run, err := seedReleaseHolidayRun(newTestClient(srv.URL, false), AuthRef{Kind: AuthBearer, Token: "traeger"}, 9,
				seedBillingRunDetail{PreviewCount: 2, PreviewCents: 9000, Fingerprint: "corrected"})
			assert.Equal(t, tc.wantReads, reads)
			if tc.wantError {
				require.Error(t, err)
				assert.True(t, seedConflictCode(err, tc.refusal), "the refusal stays visible: %v", err)
				assert.Equal(t, []string{"corrected"}, released)
				return
			}
			require.NoError(t, err)
			assert.Equal(t, []string{"corrected", "reread"}, released, "first the corrected preview, then the one read again")
			assert.Equal(t, 3, run.PreviewCount, "the step reports the released preview")
		})
	}
}
