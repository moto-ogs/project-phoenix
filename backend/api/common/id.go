package common

import (
	"strconv"
)

// ID is an int64 identifier on a registered route (ADR 0270). It renders as a
// JSON string, because a JSON number beyond 2^53 is rounded by JavaScript to
// the identifier of a different row, and reads a string or a number.
//
// JSONID keeps rendering a number for the routes that already use it.
type ID int64

// Int64 returns the identifier as the int64 the rest of the code works with.
func (id ID) Int64() int64 { return int64(id) }

// MarshalJSON renders the identifier as a decimal string.
func (id ID) MarshalJSON() ([]byte, error) {
	return strconv.AppendQuote(nil, strconv.FormatInt(int64(id), 10)), nil
}

// UnmarshalJSON accepts a decimal string or a JSON number.
func (id *ID) UnmarshalJSON(data []byte) error {
	return (*JSONID)(id).UnmarshalJSON(data)
}
