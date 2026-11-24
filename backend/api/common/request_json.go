package common

import (
	"net/http"

	"github.com/go-chi/render"

	"github.com/moto-ogs/project-phoenix/sharedkernel/ident/wire"
)

func init() {
	render.Decode = func(r *http.Request, v any) error {
		if render.GetRequestContentType(r) == render.ContentTypeJSON {
			return wire.DecodeAndDrain(r.Body, v)
		}
		return render.DefaultDecoder(r, v)
	}
}
