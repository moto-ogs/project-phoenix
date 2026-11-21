package api

import "github.com/moto-ogs/project-phoenix/demoprofile"

// apiID is an identifier in an API answer or request body: it reads a JSON
// number or a decimal string and writes a number (demoprofile.ID).
type apiID = demoprofile.ID
