package api

import (
	"encoding/json"
	"fmt"
	"maps"
)

// readSeedVersion reads the version a save of the record at path sends back
// (ADR 0311); what names the record in an error.
func readSeedVersion(rt *Runtime, auth AuthRef, path, what string) (string, error) {
	raw, err := rt.Client.GetWithAuth(auth, path)
	if err != nil {
		return "", fmt.Errorf("read %s: %w", what, err)
	}
	var read struct {
		Data struct {
			Version string `json:"version"`
		} `json:"data"`
	}
	if err := json.Unmarshal(raw, &read); err != nil {
		return "", fmt.Errorf("decode %s: %w", what, err)
	}
	return read.Data.Version, nil
}

// putReadPhase saves the phase at path over the version it reads first, as
// the phase editor does (ADR 0311).
func putReadPhase(rt *Runtime, auth AuthRef, path string, body map[string]any) error {
	version, err := readSeedVersion(rt, auth, path, "the phase")
	if err != nil {
		return err
	}
	sent := maps.Clone(body)
	sent["expected_version"] = version
	_, err = rt.Client.PutWithAuth(auth, path, sent)
	return err
}
