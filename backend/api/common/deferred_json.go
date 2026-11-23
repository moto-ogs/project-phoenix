package common

import (
	"bytes"
	"encoding/json"
)

// DeferredJSON reads an optional field with a typed value. If the value has
// the wrong shape, it retains the input for a handler that reports errors
// with the field name or delegates validation to the owner. The handler must
// check Invalid before using Value.
type DeferredJSON[T any] struct {
	Value   T
	Present bool
	Invalid json.RawMessage
}

func (field *DeferredJSON[T]) UnmarshalJSON(data []byte) error {
	*field = DeferredJSON[T]{Present: true}
	if err := json.Unmarshal(data, &field.Value); err != nil {
		field.Invalid = bytes.Clone(data)
	}
	return nil
}
