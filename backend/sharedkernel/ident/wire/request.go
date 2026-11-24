package wire

import (
	jsonv1 "encoding/json"
	"encoding/json/jsontext"
	json "encoding/json/v2"
	"fmt"
	"io"

	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

var requestOptions = json.JoinOptions(
	jsonv1.DefaultOptionsV1(),
	json.WithUnmarshalers(json.UnmarshalFromFunc(func(dec *jsontext.Decoder, id *ident.ID) error {
		value, err := dec.ReadValue()
		if err != nil {
			return err
		}
		if value.Kind() != jsontext.KindString && value.Kind() != jsontext.KindNull {
			return fmt.Errorf("identifier must be a decimal string at %q", dec.StackPointer())
		}
		return id.UnmarshalJSON(value)
	})),
)

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
