package api

import (
	"encoding/json"
	"fmt"
	"net/url"
)

// readDataVersion reads the `version` a write of the read state sends back
// as expected_version (ADR 0311): get answers the enveloped read at path.
func readDataVersion(get func(string) ([]byte, error), path string) (string, error) {
	raw, err := get(path)
	if err != nil {
		return "", fmt.Errorf("read %s: %w", path, err)
	}
	var read struct {
		Data struct {
			Version string `json:"version"`
		} `json:"data"`
	}
	if err := json.Unmarshal(raw, &read); err != nil {
		return "", fmt.Errorf("parse %s: %w", path, err)
	}
	return read.Data.Version, nil
}

// saveClassArrivalTimes stores the Unterrichtsschluss of one class against
// the class times it read first.
func (s *FixedSeeder) saveClassArrivalTimes(class string, schedules []map[string]any) error {
	version, err := readDataVersion(s.client.Get, "/api/students/class-arrival-times/"+url.PathEscape(class))
	if err != nil {
		return err
	}
	_, err = s.client.Post("/api/students/arrival-schedules/bulk", map[string]any{
		"school_class":     class,
		"expected_version": version,
		"schedules":        schedules,
	})
	if err != nil {
		return fmt.Errorf("seed class arrival times for %s: %w", class, err)
	}
	return nil
}
