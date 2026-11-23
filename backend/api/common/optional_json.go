package common

import "encoding/json"

// OptionalJSON preserves the difference between an absent field and its zero
// or null value. Use omitzero to leave an absent field off the wire.
type OptionalJSON[T any] struct {
	Value   T
	present bool
}

func (field OptionalJSON[T]) IsZero() bool { return !field.present }

func (field *OptionalJSON[T]) UnmarshalJSON(data []byte) error {
	if err := json.Unmarshal(data, &field.Value); err != nil {
		return err
	}
	field.present = true
	return nil
}

func (field OptionalJSON[T]) MarshalJSON() ([]byte, error) {
	return json.Marshal(field.Value)
}
