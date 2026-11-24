// Package ident holds the identifier every owner exchanges with a client
// (ADR 0270, ADR 0300).
package ident

import (
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
)

// ID is an int64 identifier that travels to a client as a JSON string. A JSON
// number beyond 2^53 is rounded by JavaScript to the identifier of a
// different row. At the HTTP boundary package wire reads and writes a string.
//
// encoding/json writes an ID as a JSON number, as it writes an int64: stored
// JSON (audit details, outbox payloads, snapshots, fingerprints) keeps the
// form that database functions compare with numbers (ADR 0300, Nachtrag vom
// 2026-11-21).
// Only an answer to a client writes the string: package wire. In the database
// an ID is a plain bigint.
type ID int64

// Int64 returns the identifier as the int64 the rest of the code works with.
func (id ID) Int64() int64 { return int64(id) }

// String renders the identifier in decimal.
func (id ID) String() string { return strconv.FormatInt(int64(id), 10) }

// UnmarshalJSON accepts a decimal string or a JSON number. A string is parsed
// with strconv, so digits beyond float64 precision survive, and anything that
// is not a plain integer is rejected instead of being coerced to zero. null
// leaves the value unchanged.
//
// Stored JSON continues to use numbers. HTTP request decoders use wire to
// require strings without changing the format that persistence reads.
func (id *ID) UnmarshalJSON(data []byte) error {
	trimmed := strings.TrimSpace(string(data))
	if trimmed == "null" {
		return nil
	}
	if !strings.HasPrefix(trimmed, `"`) {
		var parsed int64
		if err := json.Unmarshal(data, &parsed); err != nil {
			return err
		}
		*id = ID(parsed)
		return nil
	}
	var raw string
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return errors.New("id must not be empty")
	}
	parsed, err := strconv.ParseInt(raw, 10, 64)
	if err != nil {
		return fmt.Errorf("invalid id %q: %w", raw, err)
	}
	*id = ID(parsed)
	return nil
}

// IDs converts int64 identifiers to IDs.
func IDs(values []int64) []ID {
	if values == nil {
		return nil
	}
	out := make([]ID, len(values))
	for i, v := range values {
		out[i] = ID(v)
	}
	return out
}

// Int64s converts IDs back to int64 identifiers.
func Int64s(ids []ID) []int64 {
	if ids == nil {
		return nil
	}
	out := make([]int64, len(ids))
	for i, id := range ids {
		out[i] = int64(id)
	}
	return out
}

// OptionalInt64s converts an optional list of IDs back to int64 identifiers.
func OptionalInt64s(ids *[]ID) *[]int64 {
	if ids == nil {
		return nil
	}
	values := Int64s(*ids)
	return &values
}
