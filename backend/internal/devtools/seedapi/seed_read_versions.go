package api

import (
	"fmt"
	"maps"

	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

// readSeedVersion reads the version a save of the record at path sends back
// (ADR 0311); what names the record in an error.
func readSeedVersion(rt *Runtime, auth AuthRef, path, what string) (string, error) {
	raw, err := rt.Client.GetWithAuth(auth, path)
	if err != nil {
		return "", fmt.Errorf("read %s: %w", what, err)
	}
	return seedReadToken(raw, "version")
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

// putReadChildOfferings corrects a child's bookings over the
// offerings_version the request detail answers right before, as the
// correction editor does (ADR 0311), and returns the answer.
func putReadChildOfferings(rt *Runtime, auth AuthRef, requestID, childID int64, body map[string]any) ([]byte, error) {
	raw, err := rt.Client.GetWithAuth(auth, fmt.Sprintf("/api/enrollment/admin/requests/%d", requestID))
	if err != nil {
		return nil, fmt.Errorf("read enrollment request %d: %w", requestID, err)
	}
	var detail struct {
		Data struct {
			Children []struct {
				ID               ident.ID `json:"id"`
				OfferingsVersion string   `json:"offerings_version"`
			} `json:"children"`
		} `json:"data"`
	}
	if err := parseJSON(raw, &detail); err != nil {
		return nil, fmt.Errorf("parse enrollment request %d: %w", requestID, err)
	}
	sent := maps.Clone(body)
	for _, child := range detail.Data.Children {
		if int64(child.ID) == childID {
			sent["expected_version"] = child.OfferingsVersion
		}
	}
	if _, ok := sent["expected_version"]; !ok {
		return nil, fmt.Errorf("enrollment request %d has no child %d", requestID, childID)
	}
	return rt.Client.PutWithAuth(auth, fmt.Sprintf("/api/enrollment/admin/requests/%d/children/%d/offerings", requestID, childID), sent)
}
