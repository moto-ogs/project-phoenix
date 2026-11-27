package contract

import (
	"context"
	"errors"
	"io"
	"time"
)

// ErrNotFound reports that the requested object does not exist.
// Callers translate it to 404 rather than 500.
var ErrNotFound = errors.New("storage: object not found")

// ErrInvalidKey marks a key that failed validation (traversal, empty
// segment, absolute path). It never reaches the underlying medium.
var ErrInvalidKey = errors.New("storage: invalid key")

// ErrObjectChanged reports a failed conditional replacement.
var ErrObjectChanged = errors.New("storage: object changed during replacement")

// UploadBackend also inventories and removes namespaces for tenant erasure.
type UploadBackend interface {
	Backend
	TenantObjects(ctx context.Context, kind, layout string, tenantID int64, remove bool) (int64, error)
}

// Object carries an open byte stream and the timestamp captured when it opened.
// The caller closes Content. This is a byte capability, not a row repository.
type Object struct {
	Content    io.ReadSeekCloser
	ModifiedAt time.Time
}

// SaveOptions controls the visibility of a newly written object.
//
// Private is not a hint: it is the difference between a file that only the
// owning process can read and one that a misconfigured static mount could
// hand out. Personnel files and child documents are written private; avatars
// and login images are not.
type SaveOptions struct {
	Private bool
}

// Backend stores and retrieves opaque byte objects addressed by key.
//
// A key is a slash-separated relative path ("staff-documents/12/uuid.pdf").
// Implementations MUST reject keys that escape their root and MUST NOT
// interpret the key beyond that check — the caller owns the layout.
type Backend interface {
	// Save writes r under key, replacing any existing object, and returns
	// the number of bytes stored. A failed write leaves no partial object.
	WriteObject(ctx context.Context, key string, r io.Reader, opts SaveOptions) (int64, error)
	// Open returns the stored object. The caller closes it.
	OpenObject(ctx context.Context, key string) (*Object, error)
	// Remove deletes the object. Removing a missing object is not an error,
	// so cleanup retries are idempotent.
	RemoveObject(ctx context.Context, key string) error
	// ReplaceObject atomically replaces an existing private object with
	// content: readers see either the old or the new bytes, never a mix.
	ReplaceObject(ctx context.Context, key string, content []byte) error
	// RemoveStaleReplacements clears what interrupted replacements left in
	// the directory of prefix.
	RemoveStaleReplacements(ctx context.Context, prefix string) (int, error)
}
