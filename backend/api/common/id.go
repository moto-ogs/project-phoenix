package common

import "github.com/moto-ogs/project-phoenix/sharedkernel/ident"

// ID is the identifier on a registered route (ADR 0270). It is the shared
// kernel's ident.ID (ADR 0300): it renders as a JSON string, because a JSON
// number beyond 2^53 is rounded by JavaScript to the identifier of a different
// row, and reads a string or a number. The alias keeps one type, so a Fachtyp
// that uses ident.ID and an HTTP type that uses common.ID are the same.
//
// JSONID keeps rendering a number for the routes that still use it.
type ID = ident.ID
