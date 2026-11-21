package common

import (
	"strconv"

	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

// JSONID is an int64 request field that accepts a JSON number or a decimal
// string ("42" and 42 both decode to 42).
//
// Database ids are bigints, and JavaScript has no integer type that holds one:
// every id above 2^53 is silently rounded the moment JSON.parse sees it as a
// number, and the rounded value is a perfectly valid id for a different row.
// The frontend therefore carries ids as decimal strings — the project
// convention for int64 ids on the way out (backend int64 to frontend string) —
// and the Next.js proxy routes that parse and re-serialize a body cannot honour
// that convention while the receiving field is number-only.
//
// Accepting both keeps every existing client working: a number decodes exactly
// as it did before.
type JSONID int64

// Int64 returns the id as the int64 the rest of the code works with.
func (id JSONID) Int64() int64 { return int64(id) }

// UnmarshalJSON accepts a JSON number or a decimal string, as ident.ID does.
func (id *JSONID) UnmarshalJSON(data []byte) error {
	return (*ident.ID)(id).UnmarshalJSON(data)
}

// MarshalJSON emits a JSON number, so a struct that is decoded and re-encoded
// keeps the shape every existing consumer expects.
func (id JSONID) MarshalJSON() ([]byte, error) {
	return []byte(strconv.FormatInt(int64(id), 10)), nil
}
