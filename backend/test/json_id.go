package test

import (
	"bytes"
	"encoding/json"
	"fmt"
	"strconv"
	"testing"
)

// ID is an identifier field of a test's response or request struct. It
// reads only a decimal string, the form every registered route answers with
// (ADR 0300), and writes the same form for requests. A route
// outside the contract that still answers numbers is decoded into int64.
type ID int64

// UnmarshalJSON accepts a decimal string; null leaves the value unchanged,
// as encoding/json does for an int64. A JSON number fails, so a router test
// notices an answer that sends an identifier as a number.
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

// MarshalJSON writes a decimal string.
func (id ID) MarshalJSON() ([]byte, error) {
	return strconv.AppendQuote(nil, strconv.FormatInt(int64(id), 10)), nil
}

// IDs returns the identifiers as int64s.
func IDs[T ~int64](ids []T) []int64 {
	out := make([]int64, len(ids))
	for i, id := range ids {
		out[i] = int64(id)
	}
	return out
}

// IDsOf returns int64s as identifiers of the type T (ID or a caller's own
// copy of it).
func IDsOf[T ~int64](ids []int64) []T {
	out := make([]T, len(ids))
	for i, id := range ids {
		out[i] = T(id)
	}
	return out
}

// JSONID reads an identifier out of a value decoded into any: a decimal
// string, as a registered route answers. A number or any other value fails
// the test, so a missing or null key still fails the assertion it feeds.
func JSONID(t testing.TB, value any) int64 {
	t.Helper()
	text, ok := value.(string)
	if !ok {
		t.Fatalf("identifier %#v is no decimal string", value)
	}
	id, err := parseJSONID(strconv.AppendQuote(nil, text))
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
	var raw string
	if err := json.Unmarshal(data, &raw); err != nil {
		return 0, fmt.Errorf("identifier %s is no decimal string", data)
	}
	parsed, err := strconv.ParseInt(raw, 10, 64)
	if err != nil {
		return 0, fmt.Errorf("invalid id %q: %w", raw, err)
	}
	return parsed, nil
}
