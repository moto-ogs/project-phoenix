package common

import (
	"bytes"
	"encoding/json"
)

// LegacyJSON writes the typed Value for current data and keeps an older
// representation intact when it cannot be decoded without losing fields.
type LegacyJSON[T any] struct {
	Value  T
	Legacy any
}

func (field *LegacyJSON[T]) UnmarshalJSON(data []byte) error {
	*field = LegacyJSON[T]{}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&field.Value); err != nil {
		field.Legacy = json.RawMessage(bytes.Clone(data))
	} else if bytes.Equal(data, []byte("null")) {
		// A nil pointer may encode null, but a non-pointer struct does not.
		field.Legacy = json.RawMessage("null")
	}
	return nil
}

func (field LegacyJSON[T]) MarshalJSON() ([]byte, error) {
	if field.Legacy != nil {
		return json.Marshal(field.Legacy)
	}
	return json.Marshal(field.Value)
}
