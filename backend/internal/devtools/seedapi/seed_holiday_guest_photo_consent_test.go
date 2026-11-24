package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// The home school gets the child once: a second child of the same names
// would leave the holiday registration without a unique child, and the
// hosting school would read „Keine Foto-Einwilligung“ (#4721).
func TestSeedHomePhotoConsentCreatesTheChildOnce(t *testing.T) {
	t.Parallel()
	for name, listed := range map[string]string{
		"first seed":    `{"data":[{"id":"3","first_name":"Mia","last_name":"Sommer","group_id":"7"}]}`,
		"repeated seed": `{"data":[{"id":"9","first_name":"Ida","last_name":"Sommer"}]}`,
	} {
		var created, consents []map[string]any
		var photosOn bool
		var stops int
		srv := newSeedHTTPTestServer(func(w seedHTTPResponseWriter, r *seedHTTPRequest) {
			w.Header().Set("Content-Type", "application/json")
			var body map[string]any
			if r.Method != http.MethodGet {
				assert.NoError(t, json.NewDecoder(r.Body).Decode(&body))
			}
			switch {
			case r.URL.Path == "/api/students" && r.Method == http.MethodGet:
				_, _ = fmt.Fprint(w, listed)
			case r.URL.Path == "/api/students" && r.Method == http.MethodPost:
				created = append(created, body)
				_, _ = fmt.Fprint(w, `{"data":{"id":"9"}}`)
			case r.URL.Path == "/api/settings/values/"+profileSettingStudentPhotos && r.Method == http.MethodPut:
				photosOn = body["value"] == true
				_, _ = fmt.Fprint(w, `{"data":{}}`)
			case r.URL.Path == "/api/students/9" && r.Method == http.MethodGet:
				_, _ = fmt.Fprint(w, `{"data":{"id":"9","version":"v1"}}`)
			case r.URL.Path == "/api/students/9" && r.Method == http.MethodPut:
				assert.True(t, photosOn, "a consent needs child photos switched on")
				consents = append(consents, body)
				_, _ = fmt.Fprint(w, `{"data":{"id":"9"}}`)
			case r.URL.Path == "/api/students/9/room-history-stop" && r.Method == http.MethodPut:
				stops++
				_, _ = fmt.Fprint(w, `{"data":{"student_id":"9","stopped":true}}`)
			default:
				t.Errorf("unexpected request: %s %s", r.Method, r.URL.Path)
			}
		})
		err := seedHomePhotoConsent(newTestClient(srv.URL, false), AuthRef{})
		srv.Close()
		require.NoError(t, err, name)
		// Also a repeated seed records the consent: a first run may have
		// stopped between the child and its consent.
		require.Len(t, consents, 1, name)
		assert.Equal(t, true, consents[0]["photo_consent_given"])
		assert.Equal(t, "v1", consents[0]["expected_version"])
		assert.Equal(t, 1, stops, name)
		if name == "repeated seed" {
			assert.Empty(t, created, name)
			continue
		}
		require.Len(t, created, 1, name)
		assert.Equal(t, "Ida", created[0]["first_name"])
		assert.Equal(t, "2019-05-14", created[0]["birthday"])
		assert.Equal(t, "7", created[0]["group_id"])
	}
}
