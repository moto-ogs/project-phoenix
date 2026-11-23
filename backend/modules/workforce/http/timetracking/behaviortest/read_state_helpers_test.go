package behaviortest

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

// putRead saves a personnel-record form the way the tab does (ADR 0311): it
// reads the stored state with the same permissions first and sends the
// version of that read as expected_version. A read the permissions refuse
// yields no token; the route then answers its refusal (403, 400) before
// it checks the token, or refuses the missing token itself.
func (c *overviewAPIContext) putRead(t *testing.T, path, body string, perms ...string) *httptest.ResponseRecorder {
	t.Helper()
	return c.put(path, withExpectedVersion(t, body, c.readVersion(t, path, perms...)), perms...)
}

// readVersion is the token of the read behind a PUT path: the section
// version of the Stammdaten, the bank and tax version, the personnel
// number's version.
func (c *overviewAPIContext) readVersion(t *testing.T, path string, perms ...string) string {
	t.Helper()
	readPath, section := path, ""
	if before, after, found := strings.Cut(path, "/stammdaten/"); found && after != "bank-steuer" {
		readPath, section = before+"/stammdaten", after
	}
	rec := c.get(readPath, perms...)
	if rec.Code != http.StatusOK {
		return ""
	}
	var answer struct {
		Data struct {
			Version  string            `json:"version"`
			Versions map[string]string `json:"versions"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &answer), rec.Body.String())
	if section != "" {
		return answer.Data.Versions[section]
	}
	return answer.Data.Version
}

// withExpectedVersion adds expected_version to a JSON object body.
func withExpectedVersion(t *testing.T, body, version string) string {
	t.Helper()
	var fields map[string]any
	require.NoError(t, json.Unmarshal([]byte(body), &fields), body)
	fields["expected_version"] = version
	encoded, err := json.Marshal(fields)
	require.NoError(t, err)
	return string(encoded)
}

// historyVersion is the version of one block in a history answer: the
// token its correction sends back (ADR 0311).
func historyVersion(t *testing.T, raw []byte, sessionID string) string {
	t.Helper()
	var answer struct {
		Data struct {
			Sessions []struct {
				ID      string `json:"id"`
				Version string `json:"version"`
			} `json:"sessions"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(raw, &answer), string(raw))
	for _, session := range answer.Data.Sessions {
		if session.ID == sessionID {
			require.NotEmpty(t, session.Version)
			return session.Version
		}
	}
	t.Fatalf("block %s is not in the history: %s", sessionID, raw)
	return ""
}
