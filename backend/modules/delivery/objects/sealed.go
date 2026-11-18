package objects

import (
	"bufio"
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"time"
)

// Sealed objects (#3840): medical certificates, sick notes and payslips are
// stored encrypted with the field cipher of Security Runtime (AES-256-GCM,
// key ID inside every value). The owner of a document decides by its category
// whether and with which key ring it is sealed; this package only frames the
// bytes, so every reader opens a sealed object without knowing its category.
//
// A sealed object is: the magic "MOTOSEAL", format version 1, one byte for the
// ring ('h' health, 'b' bank), then the field cipher's value. The value is
// bound to the object key (kind, school, stored name) and the ring, so an
// object copied into another school's directory, renamed, or relabelled to
// the other ring does not open. Objects without the magic are legacy
// plaintext and are served unchanged until upload-seal has sealed them.

// File rings name the key ring an owner chooses for an object. The empty
// ring stores the object unsealed.
const (
	FileRingNone   = ""
	FileRingHealth = "health"
	FileRingBank   = "bank"
)

// maxSealedObjectBytes bounds what a sealed write or read holds in memory.
// Every sealed upload is capped far below it (10 MB documents).
const maxSealedObjectBytes = 64 << 20

var sealedMagic = []byte("MOTOSEAL")

const sealedFormat = byte(1)

// ErrSealedUnavailable reports a sealed object whose ring is not configured
// in this process, or that does not open with it. The bytes are never served.
var ErrSealedUnavailable = errors.New("storage: sealed object cannot be opened")

// FileCipher is the field cipher a ring seals and opens with.
type FileCipher interface {
	Seal(plaintext, context []byte) ([]byte, error)
	Open(sealed, context []byte) ([]byte, error)
}

// fileRewrapper re-seals a value on the active key and keeps a value that is
// already on it byte-identical, so repeated upload-seal runs converge.
type fileRewrapper interface {
	Rewrap(sealed, context []byte) ([]byte, error)
}

// FileKeys holds the rings a process may seal and open objects with. A nil
// ring cannot seal, and its objects do not open.
type FileKeys struct {
	Health FileCipher
	Bank   FileCipher
}

func (k FileKeys) cipher(ring string) (FileCipher, byte, error) {
	switch ring {
	case FileRingHealth:
		if k.Health != nil {
			return k.Health, 'h', nil
		}
	case FileRingBank:
		if k.Bank != nil {
			return k.Bank, 'b', nil
		}
	default:
		return nil, 0, fmt.Errorf("storage: unknown file ring %q", ring)
	}
	return nil, 0, ErrSealedUnavailable
}

func ringOfTag(tag byte) string {
	switch tag {
	case 'h':
		return FileRingHealth
	case 'b':
		return FileRingBank
	default:
		return ""
	}
}

func sealedAAD(key string, tag byte) []byte {
	aad := make([]byte, 0, len("moto.upload.v1")+len(key)+3)
	aad = append(aad, "moto.upload.v1"...)
	aad = append(aad, 0)
	aad = append(aad, key...)
	aad = append(aad, 0, tag)
	return aad
}

// isSealed reports whether data starts with the sealed frame.
func isSealed(data []byte) bool {
	return len(data) >= len(sealedMagic)+2 && bytes.Equal(data[:len(sealedMagic)], sealedMagic)
}

func (k FileKeys) seal(key, ring string, plaintext []byte) ([]byte, error) {
	cipher, tag, err := k.cipher(ring)
	if err != nil {
		return nil, err
	}
	value, err := cipher.Seal(plaintext, sealedAAD(key, tag))
	if err != nil {
		return nil, errors.New("storage: failed to seal object")
	}
	out := make([]byte, 0, len(sealedMagic)+2+len(value))
	out = append(out, sealedMagic...)
	out = append(out, sealedFormat, tag)
	return append(out, value...), nil
}

// open returns the plaintext of a sealed object and its ring, or data
// unchanged with the empty ring for a legacy plaintext object.
func (k FileKeys) open(key string, data []byte) ([]byte, string, error) {
	if !isSealed(data) {
		return data, FileRingNone, nil
	}
	header := len(sealedMagic)
	ring := ringOfTag(data[header+1])
	if data[header] != sealedFormat || ring == "" {
		return nil, "", ErrSealedUnavailable
	}
	cipher, tag, err := k.cipher(ring)
	if err != nil {
		return nil, "", ErrSealedUnavailable
	}
	plaintext, err := cipher.Open(data[header+2:], sealedAAD(key, tag))
	if err != nil {
		return nil, "", ErrSealedUnavailable
	}
	return plaintext, ring, nil
}

// reseal returns the bytes data should hold sealed with ring: a legacy object
// is sealed, an object already sealed with ring is moved to the active key
// (unchanged when it is on it), an object sealed with another ring is opened
// and sealed again with ring.
func (k FileKeys) reseal(key, ring string, data []byte) ([]byte, error) {
	cipher, tag, err := k.cipher(ring)
	if err != nil {
		return nil, err
	}
	if isSealed(data) && data[len(sealedMagic)] == sealedFormat && data[len(sealedMagic)+1] == tag {
		if rewrapper, ok := cipher.(fileRewrapper); ok {
			value, err := rewrapper.Rewrap(data[len(sealedMagic)+2:], sealedAAD(key, tag))
			if err != nil {
				return nil, ErrSealedUnavailable
			}
			out := append(append([]byte{}, data[:len(sealedMagic)+2]...), value...)
			return out, nil
		}
	}
	plaintext, _, err := k.open(key, data)
	if err != nil {
		return nil, err
	}
	return k.seal(key, ring, plaintext)
}

func readBounded(source io.Reader) ([]byte, error) {
	data, err := io.ReadAll(io.LimitReader(source, maxSealedObjectBytes+1))
	if err != nil {
		return nil, err
	}
	if len(data) > maxSealedObjectBytes {
		return nil, errors.New("storage: object too large to seal")
	}
	return data, nil
}

// OpenStoredObject returns a reader of the plaintext of the object stored
// under key: a sealed object is read and opened, any other is streamed as it
// is. The tenant export hands out readable originals through it; a sealed
// object that does not open stops the export.
func (k FileKeys) OpenStoredObject(key string, stored io.Reader) (io.Reader, error) {
	buffered := bufio.NewReaderSize(stored, 4096)
	head, err := buffered.Peek(len(sealedMagic) + 2)
	if err != nil && !errors.Is(err, io.EOF) {
		return nil, errors.New("storage: failed to read object")
	}
	if !isSealed(head) {
		return buffered, nil
	}
	data, err := readBounded(buffered)
	if err != nil {
		return nil, errors.New("storage: failed to read object")
	}
	plaintext, _, err := k.open(key, data)
	if err != nil {
		return nil, err
	}
	return bytes.NewReader(plaintext), nil
}

// sealedObject serves the plaintext of a sealed object through the same
// ReadSeekCloser shape as a file.
type sealedObject struct {
	*bytes.Reader
	modifiedAt time.Time
}

func (sealedObject) Close() error { return nil }

func (o sealedObject) ModTime() time.Time { return o.modifiedAt }

// openContent opens a stored object and, when it is sealed, replaces its
// content with the plaintext.
func (k FileKeys) openContent(ctx context.Context, backend Backend, key string) (*Object, error) {
	object, err := backend.OpenObject(ctx, key)
	if err != nil {
		return nil, err
	}
	head := make([]byte, len(sealedMagic)+2)
	n, readErr := io.ReadFull(object.Content, head)
	if readErr != nil && !errors.Is(readErr, io.ErrUnexpectedEOF) && !errors.Is(readErr, io.EOF) {
		_ = object.Content.Close()
		return nil, errors.New("storage: failed to read object")
	}
	if !isSealed(head[:n]) {
		if _, err := object.Content.Seek(0, io.SeekStart); err != nil {
			_ = object.Content.Close()
			return nil, errors.New("storage: failed to read object")
		}
		return object, nil
	}
	rest, err := readBounded(object.Content)
	_ = object.Content.Close()
	if err != nil {
		return nil, errors.New("storage: failed to read object")
	}
	plaintext, _, err := k.open(key, append(head[:n], rest...))
	if err != nil {
		return nil, err
	}
	return &Object{Content: sealedObject{Reader: bytes.NewReader(plaintext)}, ModifiedAt: object.ModifiedAt}, nil
}
