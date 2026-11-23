package api

import (
	"fmt"
	"strconv"
)

// staffGet reads a staff route with auth.
func staffGet(rt *Runtime, auth AuthRef) func(string) ([]byte, error) {
	return func(path string) ([]byte, error) { return rt.Client.GetWithAuth(auth, path) }
}

// showFormVersion sets the version of the form a family or the office saw
// for the phase of body, as the form client sends it: the phase's current
// form schema, read through the staff phase route with get. The submission
// sends it as its read-state token (ADR 0311); a Basis phase sends none.
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
	raw, err := get(fmt.Sprintf("/api/enrollment/phases/%d/", phaseID))
	if err != nil {
		return fmt.Errorf("form version: read phase %d: %w", phaseID, err)
	}
	var phase struct {
		Data struct {
			FormSchemaID *string `json:"form_schema_id"`
		} `json:"data"`
	}
	if err := parseJSON(raw, &phase); err != nil {
		return fmt.Errorf("form version: parse phase %d: %w", phaseID, err)
	}
	if phase.Data.FormSchemaID != nil {
		body["form_schema_id"] = *phase.Data.FormSchemaID
	}
	return nil
}
