package wire

import (
	jsonv1 "encoding/json"
	"encoding/json/jsontext"
	json "encoding/json/v2"
	"errors"
	"fmt"
	"io"

	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

var (
	requestOptions    = identifierOptions(false)
	requiredIDOptions = identifierOptions(true)
)

func identifierOptions(rejectNull bool) json.Options {
	return json.JoinOptions(
		jsonv1.DefaultOptionsV1(),
		json.WithUnmarshalers(json.UnmarshalFromFunc(func(dec *jsontext.Decoder, id *ident.ID) error {
			value, err := dec.ReadValue()
			if err != nil {
				return err
			}
			if value.Kind() != jsontext.KindString && (rejectNull || value.Kind() != jsontext.KindNull) {
				return &idDecodeError{pointer: dec.StackPointer(), error: fmt.Errorf("identifier must be a decimal string at %q", dec.StackPointer())}
			}
			if err := id.UnmarshalJSON(value); err != nil {
				return &idDecodeError{pointer: dec.StackPointer(), error: err}
			}
			return nil
		})),
	)
}

type idDecodeError struct {
	pointer jsontext.Pointer
	error
}

func (e *idDecodeError) Unwrap() error { return e.error }

// InvalidIDAt reports a malformed identifier at or beneath the JSON pointer.
func InvalidIDAt(err error, pointer string) bool {
	var invalid *idDecodeError
	return errors.As(err, &invalid) && jsontext.Pointer(pointer).Contains(invalid.pointer)
}

// Decode reads one HTTP JSON value. Only ident.ID changes interpretation;
// other fields and streaming behavior match encoding/json.Decoder.
func Decode(r io.Reader, v any) error {
	return json.UnmarshalDecode(jsontext.NewDecoder(r), v, requestOptions)
}

// DecodeAndDrain reads one JSON request value and then drains the reader,
// matching chi/render.DecodeJSON.
func DecodeAndDrain(r io.Reader, v any) error {
	defer func() { _, _ = io.Copy(io.Discard, r) }()
	return Decode(r, v)
}

// Decoder reads successive HTTP JSON values with the same rules as Decode.
type Decoder struct {
	decoder *jsontext.Decoder
}

// NewDecoder retains buffered bytes for callers that check for trailing data.
func NewDecoder(r io.Reader) *Decoder {
	return &Decoder{decoder: jsontext.NewDecoder(r)}
}

// DecodeWithRequiredIDs also rejects null for non-pointer identifier values.
// Optional pointer fields can still be null.
func (d *Decoder) DecodeWithRequiredIDs(v any) error {
	return json.UnmarshalDecode(d.decoder, v, requiredIDOptions)
}

// Decode reads the next request value.
func (d *Decoder) Decode(v any) error {
	return json.UnmarshalDecode(d.decoder, v, requestOptions)
}

// ObjectDecoder reads JSON requests with unknown fields rejected. It can read
// another value from the same stream to check for a clean EOF.
type ObjectDecoder struct {
	decoder *jsontext.Decoder
}

// NewObjectDecoder creates a streaming decoder for closed request objects.
func NewObjectDecoder(r io.Reader) *ObjectDecoder {
	return &ObjectDecoder{decoder: jsontext.NewDecoder(r)}
}

// Decode reads the next request value.
func (d *ObjectDecoder) Decode(v any) error {
	return json.UnmarshalDecode(d.decoder, v, requestOptions, json.RejectUnknownMembers(true))
}

// Unmarshal reads an HTTP JSON value already held in memory. Do not use it
// for stored JSON, whose identifiers may be numbers.
func Unmarshal(data []byte, v any) error {
	return json.Unmarshal(data, v, requestOptions)
}
