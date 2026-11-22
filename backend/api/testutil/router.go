package testutil

import (
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
)

// Router is the router shape NewJSONRouter already returns. Aliased so a route
// test names it through this boundary instead of the router library.
type Router = chi.Router

// NewRouter is a bare router, for a test that wants no JSON middleware.
func NewRouter() Router { return chi.NewRouter() }

// ServeAtRoute serves handler at its catalog line ("/operator/auth/login")
// through chi, so the test build's answer check knows which registered route
// answered and holds the answer to its contract (#7808). A pattern without
// parameters becomes the request's path.
func ServeAtRoute(w http.ResponseWriter, r *http.Request, pattern string, handler http.HandlerFunc) {
	router := chi.NewRouter()
	router.Method(r.Method, pattern, handler)
	if !strings.Contains(pattern, "{") {
		r.URL.Path = pattern
	}
	router.ServeHTTP(w, r)
}
