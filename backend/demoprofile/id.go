package demoprofile

import (
	"bytes"
	"encoding/json"
	"fmt"
	"strconv"
)

// ID is an identifier the seeder and the simulator read from an API answer
// or send in a request body. It reads a JSON number or a decimal string,
// because the registered routes move their identifiers from numbers to
// strings (ADR 0270), and writes a JSON number, which every request field
// reads before and after that move.
type ID int64

// Int64 returns the identifier as an int64.
func (id ID) Int64() int64 { return int64(id) }

// UnmarshalJSON accepts a JSON number or a decimal string; null leaves the
// value unchanged, as encoding/json does for an int64.
func (id *ID) UnmarshalJSON(data []byte) error {
	if bytes.Equal(data, []byte("null")) {
		return nil
	}
	if len(data) > 0 && data[0] == '"' {
		var raw string
		if err := json.Unmarshal(data, &raw); err != nil {
			return err
		}
		data = []byte(raw)
	}
	parsed, err := strconv.ParseInt(string(data), 10, 64)
	if err != nil {
		return fmt.Errorf("invalid id %s: %w", data, err)
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
