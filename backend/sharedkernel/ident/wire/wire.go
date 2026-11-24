// Package wire reads and writes ident.ID as a JSON string at the HTTP
// boundary (ADR 0300). Stored JSON uses encoding/json, which writes an
// ident.ID as a number and also reads that form.
package wire

import (
	jsonv1 "encoding/json"
	"encoding/json/jsontext"
	json "encoding/json/v2"
	"strconv"

	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

// options encode exactly as encoding/json does, except that an ident.ID, also
// inside an any, a slice or a pointer, is written as a decimal string.
var options = json.JoinOptions(
	jsonv1.DefaultOptionsV1(),
	json.WithMarshalers(json.MarshalToFunc(func(enc *jsontext.Encoder, id ident.ID) error {
		return enc.WriteToken(jsontext.String(strconv.FormatInt(int64(id), 10)))
	})),
)

// Marshal encodes v for an answer to a client.
func Marshal(v any) ([]byte, error) {
	return json.Marshal(v, options)
}
