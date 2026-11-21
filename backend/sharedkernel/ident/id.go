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

// ID is an int64 identifier that travels as a JSON string. A JSON number
// beyond 2^53 is rounded by JavaScript to the identifier of a different row,
// so Go writes the decimal string. It reads a decimal string or a JSON
// number, so a client that still sends numbers keeps working.
//
// It writes itself through MarshalText, not MarshalJSON: bun writes a value
// whose pointer is a json.Marshaler as JSON text, and the shared kernel may
// not import database/sql/driver for a Value method. In the database an ID
// therefore stays a plain bigint.
type ID int64

// Int64 returns the identifier as the int64 the rest of the code works with.
func (id ID) Int64() int64 { return int64(id) }

// String renders the identifier in decimal.
func (id ID) String() string { return strconv.FormatInt(int64(id), 10) }

// MarshalText renders the identifier in decimal; encoding/json writes it as a
// JSON string.
func (id ID) MarshalText() ([]byte, error) {
	return strconv.AppendInt(nil, int64(id), 10), nil
}

// UnmarshalJSON accepts a decimal string or a JSON number. A string is parsed
// with strconv, so digits beyond float64 precision survive, and anything that
// is not a plain integer is rejected instead of being coerced to zero. null
// leaves the value unchanged.
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
