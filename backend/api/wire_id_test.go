package api

import testpkg "github.com/moto-ogs/project-phoenix/test"

// wireID is testpkg.ID as a type of the root: an identifier field of a
// response or request struct that reads a JSON number or a decimal string
// and writes a number (ADR 0270). A root fixture that holds an owner's values
// and an identifier thereby holds one owner, not two (composition surface of
// scripts/backend-architecture.sh check).
type wireID int64

// UnmarshalJSON reads as testpkg.ID does.
func (id *wireID) UnmarshalJSON(data []byte) error {
	return (*testpkg.ID)(id).UnmarshalJSON(data)
}

// MarshalJSON writes a JSON number.
func (id wireID) MarshalJSON() ([]byte, error) {
	return testpkg.ID(id).MarshalJSON()
}
