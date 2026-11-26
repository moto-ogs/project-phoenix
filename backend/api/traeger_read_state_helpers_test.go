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

// traegerRecordRead reads the record as its page does; a refused read is the
// answer.
func traegerRecordRead[R ~int64](t *testing.T, router http.Handler, token string, recordID R) (*httptest.ResponseRecorder, map[string]json.RawMessage) {
	t.Helper()
	read := traegerJSON(t, router, token, http.MethodGet, fmt.Sprintf("/traeger/staff-records/%d", recordID), nil)
	if read.Code != http.StatusOK {
		return read, nil
	}
	var envelope struct {
		Data map[string]json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(read.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("read the record: %v", err)
	}
	return read, envelope.Data
}

// traegerUpdatePerson corrects the person of a record with the
// person_version of the record the card read.
func traegerUpdatePerson[R ~int64](t *testing.T, router http.Handler, token string, recordID R, body map[string]any) *httptest.ResponseRecorder {
	t.Helper()
	read, data := traegerRecordRead(t, router, token, recordID)
	if data == nil {
		return read
	}
	version, ok := readToken(t, read, "person_version")
	if !ok {
		return read
	}
	confirmed := maps.Clone(body)
	confirmed["expected_version"] = version
	return traegerJSON(t, router, token, http.MethodPut, fmt.Sprintf("/traeger/staff-records/%d/person", recordID), confirmed)
}

// traegerUpdateFinancial saves the bank section with the version of the
// section's read.
func traegerUpdateFinancial[R ~int64](t *testing.T, router http.Handler, token string, recordID R, body map[string]any) *httptest.ResponseRecorder {
	t.Helper()
	path := fmt.Sprintf("/traeger/staff-records/%d/financial", recordID)
	read := traegerJSON(t, router, token, http.MethodGet, path, nil)
	version, ok := readToken(t, read, "version")
	if !ok {
		return read
	}
	confirmed := maps.Clone(body)
	confirmed["expected_version"] = version
	return traegerJSON(t, router, token, http.MethodPut, path, confirmed)
}

// traegerContractVersion is the version of one contract in a record read; a
// read without that contract fails the test.
func traegerContractVersion[R, C ~int64](t *testing.T, router http.Handler, token string, recordID R, contractID C) string {
	t.Helper()
	read, data := traegerRecordRead(t, router, token, recordID)
	if data == nil {
		t.Fatalf("read the record: %s", read.Body.String())
	}
	var contracts []struct {
		ID      wireID `json:"id"`
		Version string `json:"version"`
	}
	if err := json.Unmarshal(data["contracts"], &contracts); err != nil {
		t.Fatalf("read the contracts: %v", err)
	}
	for _, contract := range contracts {
		if int64(contract.ID) == int64(contractID) && contract.Version != "" {
			return contract.Version
		}
	}
	t.Fatalf("the record read carries no version of contract %d: %s", contractID, read.Body.String())
	return ""
}

// traegerContractWrite sends body to a contract route (method, path) with the
// version of the contract the dialog opened on.
func traegerContractWrite[R, C ~int64](t *testing.T, router http.Handler, token, method, path string, recordID R, contractID C, body map[string]any) *httptest.ResponseRecorder {
	t.Helper()
	confirmed := maps.Clone(body)
	confirmed["expected_version"] = traegerContractVersion(t, router, token, recordID, contractID)
	return traegerJSON(t, router, token, method, path, confirmed)
}

// traegerCatalogVersion is the version of entry id in the read of a Träger
// catalog: the list itself (path answers an array) or its types field.
func traegerCatalogVersion[T ~int64](t *testing.T, router http.Handler, token, path, field string, id T) string {
	t.Helper()
	read := traegerJSON(t, router, token, http.MethodGet, path, nil)
	if read.Code != http.StatusOK {
		t.Fatalf("read %s: %s", path, read.Body.String())
	}
	var envelope struct {
		Data json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(read.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	entries := envelope.Data
	if field != "" {
		var wrapped map[string]json.RawMessage
		if err := json.Unmarshal(entries, &wrapped); err != nil {
			t.Fatalf("read %s: %v", path, err)
		}
		entries = wrapped[field]
	}
	var list []struct {
		ID      wireID `json:"id"`
		Version string `json:"version"`
	}
	if err := json.Unmarshal(entries, &list); err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	for _, entry := range list {
		if int64(entry.ID) == int64(id) && entry.Version != "" {
			return entry.Version
		}
	}
	t.Fatalf("the read of %s carries no version of %d: %s", path, id, read.Body.String())
	return ""
}

// traegerUpdateAbsenceType rewrites a type with the version of the list the
// card read.
func traegerUpdateAbsenceType[T ~int64](t *testing.T, router http.Handler, token string, id T, body map[string]any) *httptest.ResponseRecorder {
	t.Helper()
	confirmed := maps.Clone(body)
	confirmed["expected_version"] = traegerCatalogVersion(t, router, token, "/traeger/absence-types/", "types", id)
	return traegerJSON(t, router, token, http.MethodPut, fmt.Sprintf("/traeger/absence-types/%d", id), confirmed)
}

// traegerUpdateProofType rewrites a Nachweisart with the version of the
// list the dialog read.
func traegerUpdateProofType[T ~int64](t *testing.T, router http.Handler, token string, id T, body map[string]any) *httptest.ResponseRecorder {
	t.Helper()
	confirmed := maps.Clone(body)
	confirmed["expected_version"] = traegerCatalogVersion(t, router, token, "/traeger/staff-proofs/types", "", id)
	return traegerJSON(t, router, token, http.MethodPut, fmt.Sprintf("/traeger/staff-proofs/types/%d", id), confirmed)
}
