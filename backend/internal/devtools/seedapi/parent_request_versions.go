package api

import (
	"encoding/json"
	"fmt"
	"strconv"
)

// The seeder decides and shares parent requests the way the UI does: with
// the version of what it read (ADR 0311).

// parsePendingOfferingRequest reads the id and version of the open request
// the offering-change answer carries.
func parsePendingOfferingRequest(raw []byte) (int64, string, error) {
	var envelope struct {
		Data struct {
			PendingRequest *struct {
				ID      string `json:"id"`
				Version string `json:"version"`
			} `json:"pending_request"`
		} `json:"data"`
	}
	if err := parseJSON(raw, &envelope); err != nil {
		return 0, "", err
	}
	if envelope.Data.PendingRequest == nil {
		return 0, "", fmt.Errorf("pending_request missing")
	}
	id, err := strconv.ParseInt(envelope.Data.PendingRequest.ID, 10, 64)
	if err != nil || id <= 0 {
		return 0, "", fmt.Errorf("invalid pending request id")
	}
	return id, envelope.Data.PendingRequest.Version, nil
}

// readSeedRequestSharingVersion reads the version of one request's sharing,
// as the sharing dialog reads it before a choice.
func readSeedRequestSharingVersion(rt *Runtime, auth AuthRef, path string) (string, error) {
	raw, err := rt.Client.GetWithAuth(auth, path)
	if err != nil {
		return "", fmt.Errorf("read seeded request sharing: %w", err)
	}
	var read struct {
		Data struct {
			Version string `json:"version"`
		} `json:"data"`
	}
	if err := json.Unmarshal(raw, &read); err != nil {
		return "", fmt.Errorf("parse seeded request sharing: %w", err)
	}
	return read.Data.Version, nil
}
