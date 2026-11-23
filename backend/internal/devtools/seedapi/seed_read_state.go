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
