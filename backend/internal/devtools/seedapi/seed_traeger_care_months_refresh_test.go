package api

import (
	"encoding/json"
	"fmt"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

// The contract-conclusion worker can commit after the seed reads a month's
// preview (#6438). The release must reject that stale state. Only a fresh
// review may be released; setting up payment terms and mandates again would
// introduce more changes of its own.
func TestSeedCareRunReviewsAChangedPreviewBeforeReleasing(t *testing.T) {
	t.Parallel()
	for _, scenario := range []struct {
		name         string
		changes      int
		refusal      string
		wantAttempts int
		wantIssued   int
		wantError    bool
	}{
		{name: "worker concludes a contract", changes: 1, wantAttempts: 2, wantIssued: 3},
		{name: "worker changes it twice", changes: 2, wantAttempts: 3, wantIssued: 4},
		{name: "changes never settle", changes: 3, wantAttempts: 3, wantError: true},
		{name: "another seed releases the refreshed run", changes: 1, refusal: "parent_billing.billing_run_released", wantAttempts: 2},
		{name: "another conflict is not retried", refusal: "parent_billing.care_amendments_unresolved", wantAttempts: 1, wantError: true},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			t.Parallel()
			reads, releases, terms := 0, 0, 0
			revision := 0
			srv := newSeedHTTPTestServer(func(w seedHTTPResponseWriter, r *seedHTTPRequest) {
				w.Header().Set("Content-Type", "application/json")
				switch r.Method + " " + r.URL.Path {
				case "GET /traeger/care-billing-runs/":
					_, _ = fmt.Fprint(w, `{"data":{"runs":[{"id":5,"billing_month":"2026-11-01","status":"calculated","school_ids":[7]}]}}`)
				case "PUT /traeger/billing-terms/care", "PUT /traeger/billing-terms/meal", "PUT /traeger/billing-terms/holiday":
					terms++
					_, _ = fmt.Fprint(w, `{"data":{}}`)
				case "PUT /traeger/billing-run-due-dates/care/5", "PUT /traeger/sepa-creditor/",
					// The versions a change sends back (ADR 0311).
					"GET /traeger/billing-terms/", "GET /traeger/sepa-creditor/":
					_, _ = fmt.Fprint(w, `{"data":{}}`)
				case "GET /traeger/care-billing-runs/5":
					reads++
					previewRevision := revision
					// The first read prepares payment terms. Later reads are the
					// preview the seed will try to release; the worker commits next.
					if reads > 1 && revision < scenario.changes {
						revision++
					}
					_, _ = fmt.Fprintf(w, `{"data":{"id":5,"status":"calculated","preview_count":%d,"preview_cents":%d,"fingerprint":"review-%d"}}`, 2+previewRevision, 9100+100*previewRevision, previewRevision)
				case "POST /traeger/care-billing-runs/5/release":
					releases++
					var release struct {
						Count       int    `json:"document_count"`
						Cents       int64  `json:"total_cents"`
						Fingerprint string `json:"fingerprint"`
					}
					if err := json.NewDecoder(r.Body).Decode(&release); !assert.NoError(t, err) {
						return
					}
					code := scenario.refusal
					if release.Fingerprint != fmt.Sprintf("review-%d", revision) {
						code = "parent_billing.billing_run_changed"
					}
					if code != "" {
						w.Header().Set("Content-Type", "application/problem+json")
						w.WriteHeader(409)
						_, _ = fmt.Fprintf(w, `{"status":409,"code":%q,"detail":"the reviewed billing state is no longer current"}`, code)
						return
					}
					assert.Equal(t, 2+revision, release.Count)
					assert.Equal(t, int64(9100+100*revision), release.Cents)
					_, _ = fmt.Fprint(w, `{"data":{"status":"released"}}`)
				default:
					t.Errorf("unexpected request %s %s", r.Method, r.URL.Path)
				}
			})
			defer srv.Close()
			issued, err := seedCareRun(newTestClient(srv.URL, false), AuthRef{Kind: AuthBearer, Token: "traeger"}, 7, calendar.NewDate(2026, 11, 1), true)
			if scenario.wantError {
				require.Error(t, err)
				code := scenario.refusal
				if code == "" {
					code = "parent_billing.billing_run_changed"
				}
				assert.True(t, seedConflictCode(err, code), "the original refusal stays visible: %v", err)
			} else {
				require.NoError(t, err)
			}
			assert.Equal(t, scenario.wantIssued, issued)
			assert.Equal(t, scenario.wantAttempts, releases)
			assert.Equal(t, 1+scenario.wantAttempts, reads, "read a new preview for every release attempt")
			assert.Equal(t, 3, terms, "payment setup is not replayed during a fresh review")
		})
	}
}

// The contract-conclusion worker can conclude a contract after the payment
// setup read the run: its invoice joins the preview without the family's
// debtor number, the release copies none, and the DATEV file of the run is
// refused (demo-smoke-zwei, 6 invoices and no DATEV file). The seed numbers
// that family before the release and releases the preview that changed.
func TestSeedCareRunNumbersAFamilyTheWorkerAddedBeforeReleasing(t *testing.T) {
	t.Parallel()
	numberedFamilies := map[string]string{}
	var released string
	srv := newSeedHTTPTestServer(func(w seedHTTPResponseWriter, r *seedHTTPRequest) {
		w.Header().Set("Content-Type", "application/json")
		switch r.Method + " " + r.URL.Path {
		case "GET /traeger/care-billing-runs/5":
			fingerprint := "worker-added"
			if len(numberedFamilies) > 0 {
				fingerprint = "numbered"
			}
			_, _ = fmt.Fprintf(w, `{"data":{"id":5,"status":"calculated","preview_count":2,"preview_cents":9100,"fingerprint":%q,
				"invoices":[{"contract_id":"11","service":"care"},{"contract_id":"12","service":"care"}]}}`, fingerprint)
		case "GET /traeger/family-billing/contracts/12":
			_, _ = fmt.Fprint(w, `{"data":{"version":"v12"}}`)
		case "PUT /traeger/family-billing/":
			var family map[string]any
			if !assert.NoError(t, json.NewDecoder(r.Body).Decode(&family)) {
				return
			}
			assert.Equal(t, "v12", family["expected_version"], "the save sends the version it read (ADR 0311)")
			numberedFamilies[fmt.Sprint(family["contract_id"])] = fmt.Sprint(family["debtor_number"])
			_, _ = fmt.Fprint(w, `{"data":{}}`)
		case "POST /traeger/care-billing-runs/5/release":
			var release struct {
				Fingerprint string `json:"fingerprint"`
			}
			if !assert.NoError(t, json.NewDecoder(r.Body).Decode(&release)) {
				return
			}
			released = release.Fingerprint
			_, _ = fmt.Fprint(w, `{"data":{"status":"released"}}`)
		default:
			t.Errorf("unexpected request %s %s", r.Method, r.URL.Path)
		}
	})
	defer srv.Close()

	issued, err := seedReleaseCareRun(newTestClient(srv.URL, false), AuthRef{Kind: AuthBearer, Token: "traeger"}, 5,
		map[ident.ID]bool{11: true})
	require.NoError(t, err)
	assert.Equal(t, 2, issued)
	assert.Equal(t, map[string]string{"12": seedDebtorNumber(1)}, numberedFamilies, "only the family the worker added")
	assert.Equal(t, "numbered", released, "the release takes the preview with the new debtor number")
}
