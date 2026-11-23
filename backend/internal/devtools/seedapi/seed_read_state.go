package api

import (
	"encoding/json"
	"fmt"
)

// seedReadToken reads data.<field> of an answer: the version or fingerprint
// of what the seeder read, which the write that depends on it sends back
// (ADR 0311). An answer without the field yields no token; the write is then
// refused like the dialog's would be.
func seedReadToken(raw []byte, field string) (string, error) {
	var answer struct {
		Data map[string]json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(raw, &answer); err != nil {
		return "", fmt.Errorf("decode the %s of an answer: %w", field, err)
	}
	var token string
	if value, ok := answer.Data[field]; ok {
		if err := json.Unmarshal(value, &token); err != nil {
			return "", fmt.Errorf("decode the %s of an answer: %w", field, err)
		}
	}
	return token, nil
}

// putStammdatenSection saves one section of a staff member's Stammdaten
// with the section's version of a fresh read, as the tab does (ADR 0311).
func putStammdatenSection(client *Client, staffID int64, section string, body map[string]any) error {
	raw, err := client.Get(fmt.Sprintf("/api/staff/%d/stammdaten", staffID))
	if err != nil {
		return fmt.Errorf("read stammdaten of staff %d: %w", staffID, err)
	}
	var answer struct {
		Data struct {
			Versions map[string]string `json:"versions"`
		} `json:"data"`
	}
	if err := json.Unmarshal(raw, &answer); err != nil {
		return fmt.Errorf("decode stammdaten versions of staff %d: %w", staffID, err)
	}
	withToken := make(map[string]any, len(body)+1)
	for key, value := range body {
		withToken[key] = value
	}
	withToken["expected_version"] = answer.Data.Versions[section]
	_, err = client.Put(fmt.Sprintf("/api/staff/%d/stammdaten/%s", staffID, section), withToken)
	return err
}
