package common

import "github.com/moto-ogs/project-phoenix/sharedkernel/ident"

// ID is the shared kernel's ident.ID (ADR 0300). It reads a JSON string or a
// number. An answer through render.Respond or wire.Marshal writes it as a
// string, because JavaScript rounds a JSON number beyond 2^53 to the
// identifier of a different row; encoding/json writes a number, which keeps
// stored JSON as it is.
type ID = ident.ID
