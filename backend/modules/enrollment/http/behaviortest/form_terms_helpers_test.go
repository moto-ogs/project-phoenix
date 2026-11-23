package enrollmenthttp_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

// withShownTerms adds the terms_fingerprint of the form read at
// bootstrapPath to a JSON form body, as the form page sends it (ADR 0311).
// A body that names one keeps it; a read that fails leaves the body to the
// write's own refusal. headers are those of the read, such as a staff token.
func withShownTerms(t *testing.T, router http.Handler, bootstrapPath, body string, headers ...string) string {
	t.Helper()
	var payload map[string]any
	decoder := json.NewDecoder(strings.NewReader(body))
	decoder.UseNumber()
	require.NoError(t, decoder.Decode(&payload))
	if named, _ := payload["expected_terms_fingerprint"].(string); named != "" {
		return body
	}
	read := httptest.NewRequest(http.MethodGet, bootstrapPath, nil)
	for i := 0; i+1 < len(headers); i += 2 {
		read.Header.Set(headers[i], headers[i+1])
	}
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, read)
	if rec.Code != http.StatusOK {
		return body
	}
	var shown struct {
		Data struct {
			TermsFingerprint string `json:"terms_fingerprint"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &shown))
	payload["expected_terms_fingerprint"] = shown.Data.TermsFingerprint
	out, err := json.Marshal(payload)
	require.NoError(t, err)
	return string(out)
}
