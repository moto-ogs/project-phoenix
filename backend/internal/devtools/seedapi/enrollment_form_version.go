package api

import (
	"fmt"
	"strconv"
)

// staffGet reads a staff route with auth.
func staffGet(rt *Runtime, auth AuthRef) func(string) ([]byte, error) {
	return func(path string) ([]byte, error) { return rt.Client.GetWithAuth(auth, path) }
}

// showFormVersion sets the form a family or the office saw for the phase of
// body, as the form client sends it: the version and the terms_fingerprint
// of the phase's form, read through the staff form load with get. The
// submission sends the fingerprint as its read-state token (ADR 0311).
func showFormVersion(get func(string) ([]byte, error), body map[string]any) error {
	var phaseID int64
	switch id := body["phase_id"].(type) {
	case int64:
		phaseID = id
	case string:
		parsed, err := strconv.ParseInt(id, 10, 64)
		if err != nil {
			return fmt.Errorf("form version: phase id %q: %w", id, err)
		}
		phaseID = parsed
	default:
		return fmt.Errorf("form version: submission without phase id (%T)", body["phase_id"])
	}
	return showPhaseFormVersion(get, phaseID, body)
}

// showPhaseFormVersion is showFormVersion for a body whose phase travels in
// the path (the office's manual enrollment).
func showPhaseFormVersion(get func(string) ([]byte, error), phaseID int64, body map[string]any) error {
	raw, err := get(fmt.Sprintf("/api/enrollment/phases/%d/manual-bootstrap", phaseID))
	if err != nil {
		return fmt.Errorf("form version: read form of phase %d: %w", phaseID, err)
	}
	return showForm(raw, body)
}

// showEditForm sets the form a family saw on the edit page of its request,
// read from the edit bootstrap, on an edit or change request body.
func showEditForm(get func(string) ([]byte, error), statusToken string, body map[string]any) error {
	raw, err := get(fmt.Sprintf("/api/enrollment/requests/%s/edit-bootstrap", statusToken))
	if err != nil {
		return fmt.Errorf("form version: read edit form: %w", err)
	}
	return showForm(raw, body)
}

// postEditForm sends a change request or an edit of the request behind
// statusToken with the form its edit page shows now.
func postEditForm(rt *Runtime, statusToken, path string, body map[string]any) ([]byte, error) {
	delete(body, "expected_terms_fingerprint")
	if err := showEditForm(rt.Client.GetPublic, statusToken, body); err != nil {
		return nil, err
	}
	return rt.Client.PostPublic(path, body)
}

// showForm copies the version and the terms_fingerprint of a form read into
// body. A step that pins the form version itself keeps it.
func showForm(raw []byte, body map[string]any) error {
	var form struct {
		Data struct {
			Schema *struct {
				ID string `json:"id"`
			} `json:"schema"`
			TermsFingerprint string `json:"terms_fingerprint"`
		} `json:"data"`
	}
	if err := parseJSON(raw, &form); err != nil {
		return fmt.Errorf("form version: parse form: %w", err)
	}
	if form.Data.TermsFingerprint == "" {
		return fmt.Errorf("form version: form read without terms_fingerprint")
	}
	body["expected_terms_fingerprint"] = form.Data.TermsFingerprint
	if _, named := body["form_schema_id"]; !named && form.Data.Schema != nil {
		body["form_schema_id"] = form.Data.Schema.ID
	}
	return nil
}

// postShownForm sends a submission through post with the version of the
// form shown for its phase, read with get (showFormVersion).
func postShownForm(get func(string) ([]byte, error), body map[string]any, post func(map[string]any) ([]byte, error)) ([]byte, error) {
	if err := showFormVersion(get, body); err != nil {
		return nil, err
	}
	return post(body)
}
