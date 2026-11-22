package common

import (
	"net/http"
	"reflect"

	"github.com/go-chi/render"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident/wire"
)

// Every answer rendered through chi's render (Respond, RenderError and the
// handlers' own render.Render calls) writes identifiers as JSON strings
// (ADR 0300, addendum). Stored JSON keeps them as numbers.
func init() {
	render.Respond = respondWire
}

// respondWire is chi's DefaultResponder with the JSON branch encoded by
// RenderJSON. Event streams and XML keep chi's handling.
func respondWire(w http.ResponseWriter, r *http.Request, v any) {
	accepted := render.GetAcceptedContentType(r)
	if (v != nil && reflect.TypeOf(v).Kind() == reflect.Chan) || accepted == render.ContentTypeXML {
		render.DefaultResponder(w, r, v)
		return
	}
	RenderJSON(w, r, v)
}

// RenderJSON writes v as render.JSON does, with every ident.ID
// as a JSON string. Use it instead of render.JSON for an answer to a client.
func RenderJSON(w http.ResponseWriter, r *http.Request, v any) {
	body, err := wire.Marshal(v)
	if err != nil {
		RenderError(w, r, ErrorInternalServerWrap("error rendering response", err))
		return
	}
	w.Header().Set("Content-Type", "application/json")
	if status, ok := r.Context().Value(render.StatusCtxKey).(int); ok {
		w.WriteHeader(status)
	}
	_, _ = w.Write(append(body, '\n'))
}
