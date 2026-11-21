package test

import (
	"bytes"
	"encoding/json"
	"fmt"
	"strconv"
	"testing"
)

// ID is an identifier field of a test's response or request struct. It reads
// a JSON number or a decimal string and writes a JSON number, so an assertion
// on a registered route holds before and after the route sends its
// identifiers as strings (ADR 0270). A test that pins the wire form itself
// decodes into int64 or string instead.
type ID int64

// Int64 returns the identifier as an int64.
func (id ID) Int64() int64 { return int64(id) }

// UnmarshalJSON accepts a JSON number or a decimal string; null leaves the
// value unchanged, as encoding/json does for an int64.
func (id *ID) UnmarshalJSON(data []byte) error {
	if bytes.Equal(data, []byte("null")) {
		return nil
	}
	parsed, err := parseJSONID(data)
	if err != nil {
		return err
	}
	*id = ID(parsed)
	return nil
}

// MarshalJSON writes a JSON number.
func (id ID) MarshalJSON() ([]byte, error) {
	return strconv.AppendInt(nil, int64(id), 10), nil
}

// IDs returns the identifiers as int64s.
func IDs(ids []ID) []int64 {
	out := make([]int64, len(ids))
	for i, id := range ids {
		out[i] = int64(id)
	}
	return out
}

// IDsOf returns int64s as identifiers.
func IDsOf(ids []int64) []ID {
	out := make([]ID, len(ids))
	for i, id := range ids {
		out[i] = ID(id)
	}
	return out
}

// JSONID reads an identifier out of a value decoded into any: a JSON number
// (float64 or json.Number) or a decimal string. Any other value fails the
// test, so a missing or null key still fails the assertion it feeds.
func JSONID(t testing.TB, value any) int64 {
	t.Helper()
	var raw []byte
	switch v := value.(type) {
	case float64:
		if v != float64(int64(v)) {
			t.Fatalf("identifier %v is no integer", v)
		}
		return int64(v)
	case json.Number:
		raw = []byte(v)
	case string:
		raw = strconv.AppendQuote(nil, v)
	default:
		t.Fatalf("identifier %#v is neither a JSON number nor a decimal string", value)
	}
	id, err := parseJSONID(raw)
	if err != nil {
		t.Fatal(err)
	}
	return id
}

// JSONIDs reads a list of identifiers out of a value decoded into any.
func JSONIDs(t testing.TB, value any) []int64 {
	t.Helper()
	list, ok := value.([]any)
	if !ok {
		t.Fatalf("identifiers %#v are no JSON array", value)
	}
	out := make([]int64, len(list))
	for i, item := range list {
		out[i] = JSONID(t, item)
	}
	return out
}

func parseJSONID(data []byte) (int64, error) {
	if len(data) > 0 && data[0] == '"' {
		var raw string
		if err := json.Unmarshal(data, &raw); err != nil {
			return 0, err
		}
		data = []byte(raw)
	}
	parsed, err := strconv.ParseInt(string(data), 10, 64)
	if err != nil {
		return 0, fmt.Errorf("invalid id %s: %w", data, err)
	}
	return parsed, nil
}
