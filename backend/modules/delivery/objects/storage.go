// Package objects owns every byte the application writes outside the
// database. Before it existed, six upload families each resolved their own
// directory and called os.* inline, so save, serve and delete of the same
// file could disagree about where it lived. Everything now goes through one
// Backend, which makes that class of bug structural rather than a matter of
// review discipline, and makes an object-store implementation a drop-in
// replacement instead of a sweep through every handler.
package objects

import "github.com/moto-ogs/project-phoenix/modules/delivery/contract"

// The object contract lives beside Delivery's other provider contracts so
// local and remote adapters share the same types and error identities.
type (
	Backend       = contract.Backend
	UploadBackend = contract.UploadBackend
	Object        = contract.Object
	SaveOptions   = contract.SaveOptions
)

var (
	ErrNotFound      = contract.ErrNotFound
	ErrInvalidKey    = contract.ErrInvalidKey
	ErrObjectChanged = contract.ErrObjectChanged
)
