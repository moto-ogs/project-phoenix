package api

import (
	"encoding/json"
	"fmt"
	"maps"
	"net/http"
	"net/http/httptest"
	"testing"
)

// The Träger writes that depend on what the Personalverwaltung read send the
// token of that read (ADR 0311). These helpers read first, as the dialogs
// do. A refused read is the answer, as in the dialog, which sends nothing
// without its read; a read that answers without its token fails the test.

// traegerLink links the employments of body with the fingerprint of their
// preview.
func traegerLink(t *testing.T, router http.Handler, token string, body map[string]any) *httptest.ResponseRecorder {
	t.Helper()
	confirmed := maps.Clone(body)
	read := traegerJSON(t, router, token, http.MethodPost, "/traeger/staff-records/link-preview", body)
	fingerprint, ok := readToken(t, read, "fingerprint")
	if !ok {
		return read
	}
	confirmed["expected_fingerprint"] = fingerprint
	return traegerJSON(t, router, token, http.MethodPost, "/traeger/staff-records/", confirmed)
}

// traegerCloseMonth closes the month of body at accountPath
// (/traeger/staff-records/{id}/time-account) with the fingerprint of that
// month's read.
func traegerCloseMonth(t *testing.T, router http.Handler, token, accountPath string, body map[string]any) *httptest.ResponseRecorder {
	t.Helper()
	confirmed := maps.Clone(body)
	read := traegerJSON(t, router, token, http.MethodGet, fmt.Sprintf("%s?year=%v&month=%v", accountPath, body["year"], body["month"]), nil)
	fingerprint, ok := readToken(t, read, "fingerprint")
	if !ok {
		return read
	}
	confirmed["expected_fingerprint"] = fingerprint
	return traegerJSON(t, router, token, http.MethodPost, accountPath+"/close", confirmed)
}

// traegerSetAllowance sets the days of body with the version of the account
// the form read.
func traegerSetAllowance[R, T ~int64](t *testing.T, router http.Handler, token string, recordID R, typeID T, body map[string]any) *httptest.ResponseRecorder {
	t.Helper()
	confirmed := maps.Clone(body)
	read := traegerJSON(t, router, token, http.MethodGet, fmt.Sprintf("/traeger/staff-records/%d/absence-accounts?year=%v", recordID, body["year"]), nil)
	if read.Code != http.StatusOK {
		return read
	}
	confirmed["expected_version"] = allowanceVersion(t, read, int64(typeID))
	return traegerJSON(t, router, token, http.MethodPut, fmt.Sprintf("/traeger/staff-records/%d/absence-accounts/%d", recordID, typeID), confirmed)
}

// allowanceVersion is the version of one type's account in a read; a read
// without that account fails the test.
func allowanceVersion(t *testing.T, rec *httptest.ResponseRecorder, typeID int64) string {
	t.Helper()
	var read struct {
		Data struct {
			Accounts []struct {
				AbsenceTypeID string `json:"absence_type_id"`
				Version       string `json:"version"`
			} `json:"accounts"`
		} `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &read); err != nil {
		t.Fatalf("absence accounts: %v", err)
	}
	for _, account := range read.Data.Accounts {
		if account.AbsenceTypeID == fmt.Sprint(typeID) {
			return account.Version
		}
	}
	t.Fatalf("absence accounts: no account of type %d", typeID)
	return ""
}

// readToken reads data.<field> of a successful answer; false for a refused
// read. A successful answer without the field fails the test.
func readToken(t *testing.T, rec *httptest.ResponseRecorder, field string) (string, bool) {
	t.Helper()
	if rec.Code != http.StatusOK {
		return "", false
	}
	var read struct {
		Data map[string]json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &read); err != nil {
		t.Fatalf("read %s: %v", field, err)
	}
	var token string
	if err := json.Unmarshal(read.Data[field], &token); err != nil || token == "" {
		t.Fatalf("read %s: the answer carries none: %s", field, rec.Body.String())
	}
	return token, true
}
