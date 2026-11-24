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

// publishParentAnnouncement publishes the announcement its create answered
// as its author read it: with the version of that stored draft (ADR 0311).
// A nil auth uses the client's bound session.
func publishParentAnnouncement(rt *Runtime, auth *AuthRef, id int64, created []byte) ([]byte, error) {
	version, err := readDataVersion(func(string) ([]byte, error) { return created, nil }, "the created announcement")
	if err != nil {
		return nil, err
	}
	return publishParentAnnouncementVersion(rt, auth, id, version)
}

// attachToParentAnnouncement uploads a file to the draft of the given
// version and answers the version the upload stamped: an attachment is part
// of what the publication confirms (ADR 0311).
func attachToParentAnnouncement(rt *Runtime, id int64, version, filename string, document []byte) (string, error) {
	raw, err := rt.Client.PostFile(fmt.Sprintf("/api/announcement-attachments/%d?expected_version=%s", id, url.QueryEscape(version)), "file", filename, document)
	if err != nil {
		return "", err
	}
	var uploaded struct {
		Data struct {
			AnnouncementVersion string `json:"announcement_version"`
		} `json:"data"`
	}
	if err := json.Unmarshal(raw, &uploaded); err != nil {
		return "", fmt.Errorf("parse attachment upload: %w", err)
	}
	return uploaded.Data.AnnouncementVersion, nil
}

// publishParentAnnouncementVersion publishes the draft of the given version.
func publishParentAnnouncementVersion(rt *Runtime, auth *AuthRef, id int64, version string) ([]byte, error) {
	path := fmt.Sprintf("/api/parent-announcements/%d/publish", id)
	body := map[string]any{"expected_version": version}
	if auth != nil {
		return rt.Client.PostWithAuth(*auth, path, body)
	}
	return rt.Client.Post(path, body)
}
