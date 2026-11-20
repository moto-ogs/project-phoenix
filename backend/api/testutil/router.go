package testutil

import "github.com/go-chi/chi/v5"

// Router is the router shape NewJSONRouter already returns. Aliased so a route
// test names it through this boundary instead of the router library.
type Router = chi.Router

// NewRouter is a bare router, for a test that wants no JSON middleware.
func NewRouter() Router { return chi.NewRouter() }
