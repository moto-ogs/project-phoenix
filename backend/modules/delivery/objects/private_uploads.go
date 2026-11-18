package objects

import (
	"bytes"
	"context"
	"errors"
	"io"
	"time"
)

// PrivateUploads binds managed tenant objects to the shared uploads backend.
// Callers supply the storage kind; tenant keys are validated before every access.
// With file keys it seals the objects an owner asks to seal and opens every
// sealed object it reads (#3840).
type PrivateUploads struct {
	backend Backend
	keys    FileKeys
}

// PrivateUploadsBackend resolves the same uploads root as other document flows.
// It holds no file keys: it writes plaintext and does not open sealed objects.
func PrivateUploadsBackend() (*PrivateUploads, error) {
	return SealedPrivateUploadsBackend(FileKeys{})
}

// SealedPrivateUploadsBackend resolves the uploads root with the rings the
// process may seal and open objects with.
func SealedPrivateUploadsBackend(keys FileKeys) (*PrivateUploads, error) {
	backend, err := UploadsBackend()
	if err != nil {
		return nil, err
	}
	return NewPrivateUploads(backend, keys), nil
}

// NewPrivateUploads binds a backend and file keys; tests pass a temporary root.
func NewPrivateUploads(backend Backend, keys FileKeys) *PrivateUploads {
	return &PrivateUploads{backend: backend, keys: keys}
}

func (s *PrivateUploads) SavePrivate(ctx context.Context, kind string, tenantID int64, storedName string, source io.Reader) (int64, error) {
	return s.SaveSealed(ctx, kind, tenantID, storedName, source, FileRingNone)
}

// SaveSealed writes the object private and, unless ring is empty, sealed with
// that ring. It returns the size of the plaintext, the size the owner shows.
func (s *PrivateUploads) SaveSealed(ctx context.Context, kind string, tenantID int64, storedName string, source io.Reader, ring string) (int64, error) {
	key, err := TenantKey(kind, tenantID, storedName)
	if err != nil {
		return 0, err
	}
	if ring == FileRingNone {
		return s.backend.WriteObject(ctx, key, source, SaveOptions{Private: true})
	}
	plaintext, err := readBounded(&contextReader{ctx: ctx, r: source})
	if err != nil {
		if ctx.Err() != nil {
			return 0, ctx.Err()
		}
		return 0, errors.New("storage: failed to read object")
	}
	sealed, err := s.keys.seal(key, ring, plaintext)
	if err != nil {
		return 0, err
	}
	if _, err := s.backend.WriteObject(ctx, key, bytes.NewReader(sealed), SaveOptions{Private: true}); err != nil {
		return 0, err
	}
	return int64(len(plaintext)), nil
}

func (s *PrivateUploads) OpenPrivate(ctx context.Context, kind string, tenantID int64, storedName string) (interface {
	io.ReadSeekCloser
	ModTime() time.Time
}, error) {
	key, err := TenantKey(kind, tenantID, storedName)
	if err != nil {
		return nil, err
	}
	object, err := s.keys.openContent(ctx, s.backend, key)
	if err != nil {
		return nil, err
	}
	return &privateUploadObject{ReadSeekCloser: object.Content, modifiedAt: object.ModifiedAt}, nil
}

// ResealPrivate brings one stored object onto ring and its active key: a
// legacy plaintext object is sealed, a sealed one re-sealed when its key is
// not the active one. It reports whether the bytes changed; a missing object
// reports ErrNotFound. The replacement is atomic, so a crash leaves either
// the old or the new object.
func (s *PrivateUploads) ResealPrivate(ctx context.Context, kind string, tenantID int64, storedName, ring string) (bool, error) {
	key, err := TenantKey(kind, tenantID, storedName)
	if err != nil {
		return false, err
	}
	if ring == FileRingNone {
		return false, errors.New("storage: a ring is required to reseal")
	}
	object, err := s.backend.OpenObject(ctx, key)
	if err != nil {
		return false, err
	}
	data, err := readBounded(object.Content)
	_ = object.Content.Close()
	if err != nil {
		return false, errors.New("storage: failed to read object")
	}
	resealed, err := s.keys.reseal(key, ring, data)
	if err != nil {
		return false, err
	}
	if bytes.Equal(resealed, data) {
		return false, nil
	}
	if err := s.backend.ReplaceObject(ctx, key, resealed); err != nil {
		return false, err
	}
	return true, nil
}

func (s *PrivateUploads) RemovePrivate(ctx context.Context, kind string, tenantID int64, storedName string) error {
	key, err := TenantKey(kind, tenantID, storedName)
	if err != nil {
		return err
	}
	return s.backend.RemoveObject(ctx, key)
}

type privateUploadObject struct {
	io.ReadSeekCloser
	modifiedAt time.Time
}

func (o *privateUploadObject) ModTime() time.Time { return o.modifiedAt }
