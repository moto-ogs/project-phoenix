package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestSeedHolidayLegalUsesSavedFormVersion(t *testing.T) {
	t.Parallel()
	for _, version := range []int{2, 7} {
		t.Run(fmt.Sprint(version), func(t *testing.T) {
			t.Parallel()
			var submitted, confirmed map[string]any
			srv := newSeedHTTPTestServer(func(w seedHTTPResponseWriter, r *seedHTTPRequest) {
				w.Header().Set("Content-Type", "application/json")
				switch {
				case r.Method == http.MethodGet && r.URL.Path == "/traeger/holiday-periods/5/form":
					_, _ = w.Write([]byte(`{"data":{"fields":[]}}`))
				case r.Method == http.MethodPut && r.URL.Path == "/traeger/holiday-periods/5/form":
					_ = json.NewEncoder(w).Encode(map[string]any{"data": map[string]any{"version": version}})
				case r.URL.Path == "/traeger/holiday-periods/5/form/documents":
					_, _ = w.Write([]byte(`{"data":{"id":"9"}}`))
				case r.URL.Path == "/traeger/holiday-registrations/link-key":
					if err := json.NewDecoder(r.Body).Decode(&submitted); err != nil {
						t.Error(err)
						w.WriteHeader(http.StatusBadRequest)
						return
					}
					if submitted["form_version"] != float64(version) {
						w.WriteHeader(http.StatusBadRequest)
						_, _ = w.Write([]byte(`{"code":"enrollment.holiday_registration_form_changed"}`))
						return
					}
					_, _ = w.Write([]byte(`{"data":{"id":11}}`))
				case r.Method == http.MethodGet && r.URL.Path == "/traeger/holiday-contributions/5/registrations/11":
					_, _ = w.Write([]byte(`{"data":{"fingerprint":"beitrag-1"}}`))
				case r.Method == http.MethodPost && r.URL.Path == "/traeger/holiday-contributions/5/registrations/11/confirm":
					if err := json.NewDecoder(r.Body).Decode(&confirmed); err != nil {
						t.Error(err)
					}
					_, _ = w.Write([]byte(`{"data":{}}`))
				default:
					t.Errorf("unexpected request: %s %s", r.Method, r.URL.Path)
					w.WriteHeader(http.StatusNotFound)
				}
			})
			defer srv.Close()
			runtime := &Runtime{
				Client:    newTestClient(srv.URL, false),
				Bootstrap: &bootstrapSeedState{},
				Values: map[string]any{
					seedHolidayLegalPeriodKey:    int64(5),
					seedTraegerSessionKey:        seedTraegerSessionRef{},
					seedHolidayLegalPublishedKey: []byte(`{"data":{"public_token":"link-key","weeks":[{"id":51,"time_models":[{"id":61},{"id":62}]},{"id":52,"time_models":[{"id":63}]}]}}`),
				},
			}
			require.NoError(t, (seedHolidayLegalStep{}).Run(context.Background(), runtime))
			assert.Equal(t, float64(version), submitted["form_version"])
			assert.Equal(t, map[string]any{"hinweis_1": true, "hinweis_2": true, "fotos_ferien": true}, submitted["legal_acceptances"])
			// Without a seeded parent the registration has no account; the
			// Träger confirms it so the hosting school lists its consent (#8038).
			assert.NotContains(t, submitted, "parent_account_proof")
			assert.Equal(t, "beitrag-1", confirmed["expected_fingerprint"])
		})
	}
}
