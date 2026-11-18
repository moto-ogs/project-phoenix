package objects

import (
	"bytes"
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"testing"
)

// testRing stands in for the field cipher of Security Runtime: a key ID in
// every value, the active key first, the context authenticated. It is no
// cipher (this package may not import crypto); the API and CLI tests run the
// real ring. Each "key" is a byte XORed into the value.
type testRing struct {
	active string
	keys   map[string]byte
}

func newTestRing(t *testing.T, ids ...string) *testRing {
	t.Helper()
	ring := &testRing{active: ids[0], keys: map[string]byte{}}
	for _, id := range ids {
		var fill byte = 0x5a
		for _, c := range []byte(id) {
			fill += c
		}
		ring.keys[id] = fill
	}
	return ring
}

func (r *testRing) Seal(plaintext, aad []byte) ([]byte, error) {
	out := append([]byte{byte(len(r.active))}, r.active...)
	out = append(out, byte(len(aad)>>8), byte(len(aad)))
	out = append(out, aad...)
	for _, b := range plaintext {
		out = append(out, b^r.keys[r.active])
	}
	return out, nil
}

func (r *testRing) Open(sealed, aad []byte) ([]byte, error) {
	if len(sealed) < 1 || len(sealed) < 3+int(sealed[0]) {
		return nil, errors.New("short")
	}
	id := string(sealed[1 : 1+sealed[0]])
	key, ok := r.keys[id]
	rest := sealed[1+len(id):]
	length := int(rest[0])<<8 | int(rest[1])
	if !ok || len(rest) < 2+length || !bytes.Equal(rest[2:2+length], aad) {
		return nil, errors.New("does not open")
	}
	plaintext := make([]byte, 0, len(rest)-2-length)
	for _, b := range rest[2+length:] {
		plaintext = append(plaintext, b^key)
	}
	return plaintext, nil
}

func (r *testRing) Rewrap(sealed, aad []byte) ([]byte, error) {
	plaintext, err := r.Open(sealed, aad)
	if err != nil {
		return nil, err
	}
	if string(sealed[1:1+sealed[0]]) == r.active {
		return sealed, nil
	}
	return r.Seal(plaintext, aad)
}

func readAllObject(t *testing.T, object io.ReadCloser) []byte {
	t.Helper()
	defer func() { _ = object.Close() }()
	data, err := io.ReadAll(object)
	if err != nil {
		t.Fatal(err)
	}
	return data
}

func TestSealedObjectsRoundTripBindAndServeLegacy(t *testing.T) {
	t.Parallel()
	root := t.TempDir()
	health, bank := newTestRing(t, "h1"), newTestRing(t, "b1")
	store := NewPrivateUploads(NewLocal(root), FileKeys{Health: health, Bank: bank})
	ctx := context.Background()
	content := []byte("%PDF-1.4 sick note")

	for _, ring := range []string{FileRingHealth, FileRingBank} {
		size, err := store.SaveSealed(ctx, "staff-documents", 7, ring+".pdf", bytes.NewReader(content), ring)
		if err != nil || size != int64(len(content)) {
			t.Fatalf("SaveSealed(%s) = %d, %v", ring, size, err)
		}
		onDisk, err := os.ReadFile(filepath.Join(root, "staff-documents", "7", ring+".pdf"))
		if err != nil {
			t.Fatal(err)
		}
		if !bytes.HasPrefix(onDisk, sealedMagic) || bytes.Contains(onDisk, content) {
			t.Fatalf("%s object is not sealed on disk", ring)
		}
		object, err := store.OpenPrivate(ctx, "staff-documents", 7, ring+".pdf")
		if err != nil {
			t.Fatal(err)
		}
		if got := readAllObject(t, object); !bytes.Equal(got, content) {
			t.Fatalf("opened %q", got)
		}
	}

	// Bound to school and name: a copy into another school or onto another
	// name does not open, and nothing is served.
	sealed, _ := os.ReadFile(filepath.Join(root, "staff-documents", "7", "health.pdf"))
	for _, target := range []string{filepath.Join(root, "staff-documents", "8", "health.pdf"), filepath.Join(root, "staff-documents", "7", "other.pdf")} {
		if err := os.MkdirAll(filepath.Dir(target), 0o700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(target, sealed, 0o600); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := store.OpenPrivate(ctx, "staff-documents", 8, "health.pdf"); !errors.Is(err, ErrSealedUnavailable) {
		t.Fatalf("another school's copy opened: %v", err)
	}
	if _, err := store.OpenPrivate(ctx, "staff-documents", 7, "other.pdf"); !errors.Is(err, ErrSealedUnavailable) {
		t.Fatalf("a renamed copy opened: %v", err)
	}
	// The ring tag is authenticated: relabelling a health object as bank fails.
	relabelled := append([]byte{}, sealed...)
	relabelled[len(sealedMagic)+1] = 'b'
	if err := os.WriteFile(filepath.Join(root, "staff-documents", "7", "health.pdf"), relabelled, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := store.OpenPrivate(ctx, "staff-documents", 7, "health.pdf"); !errors.Is(err, ErrSealedUnavailable) {
		t.Fatalf("a relabelled object opened: %v", err)
	}

	// A process without the ring never serves the sealed bytes.
	keyless := NewPrivateUploads(NewLocal(root), FileKeys{})
	if _, err := keyless.OpenPrivate(ctx, "staff-documents", 7, "bank.pdf"); !errors.Is(err, ErrSealedUnavailable) {
		t.Fatalf("keyless open: %v", err)
	}
	if _, err := keyless.SaveSealed(ctx, "staff-documents", 7, "x.pdf", bytes.NewReader(content), FileRingHealth); !errors.Is(err, ErrSealedUnavailable) {
		t.Fatalf("keyless seal: %v", err)
	}

	// Legacy plaintext objects serve unchanged.
	if _, err := store.SavePrivate(ctx, "staff-documents", 7, "legacy.pdf", bytes.NewReader(content)); err != nil {
		t.Fatal(err)
	}
	object, err := store.OpenPrivate(ctx, "staff-documents", 7, "legacy.pdf")
	if err != nil {
		t.Fatal(err)
	}
	if got := readAllObject(t, object); !bytes.Equal(got, content) {
		t.Fatalf("legacy %q", got)
	}
}

func TestResealPrivateSealsLegacyRotatesAndConverges(t *testing.T) {
	t.Parallel()
	root := t.TempDir()
	ctx := context.Background()
	content := []byte("%PDF-1.4 payslip")
	old := newTestRing(t, "b1")
	store := NewPrivateUploads(NewLocal(root), FileKeys{Bank: old})
	if _, err := store.SavePrivate(ctx, "staff-documents", 3, "pay.pdf", bytes.NewReader(content)); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(root, "staff-documents", "3", "pay.pdf")

	changed, err := store.ResealPrivate(ctx, "staff-documents", 3, "pay.pdf", FileRingBank)
	if err != nil || !changed {
		t.Fatalf("first pass: %v %v", changed, err)
	}
	first, _ := os.ReadFile(path)
	if changed, err := store.ResealPrivate(ctx, "staff-documents", 3, "pay.pdf", FileRingBank); err != nil || changed {
		t.Fatalf("second pass must converge: %v %v", changed, err)
	}
	if again, _ := os.ReadFile(path); !bytes.Equal(again, first) {
		t.Fatal("a converged object changed")
	}

	// Rotation: a new active key in front, the old one kept for reading.
	rotated := newTestRing(t, "b2")
	rotated.keys["b1"] = old.keys["b1"]
	store = NewPrivateUploads(NewLocal(root), FileKeys{Bank: rotated})
	if changed, err := store.ResealPrivate(ctx, "staff-documents", 3, "pay.pdf", FileRingBank); err != nil || !changed {
		t.Fatalf("rotation pass: %v %v", changed, err)
	}
	if changed, err := store.ResealPrivate(ctx, "staff-documents", 3, "pay.pdf", FileRingBank); err != nil || changed {
		t.Fatalf("rotation must converge: %v %v", changed, err)
	}
	delete(rotated.keys, "b1")
	object, err := store.OpenPrivate(ctx, "staff-documents", 3, "pay.pdf")
	if err != nil {
		t.Fatalf("object not on the new key: %v", err)
	}
	if got := readAllObject(t, object); !bytes.Equal(got, content) {
		t.Fatalf("rotated %q", got)
	}
	info, _ := os.Stat(path)
	if info.Mode().Perm() != privateFileMode {
		t.Fatalf("replaced object mode %v", info.Mode().Perm())
	}

	// A removed document is never re-created.
	if _, err := store.ResealPrivate(ctx, "staff-documents", 3, "gone.pdf", FileRingBank); !errors.Is(err, ErrNotFound) {
		t.Fatalf("missing object: %v", err)
	}
	if _, err := os.Stat(filepath.Join(root, "staff-documents", "3", "gone.pdf")); !os.IsNotExist(err) {
		t.Fatal("reseal re-created a removed object")
	}
}

func TestOpenStoredObjectOpensSealedAndStreamsOthers(t *testing.T) {
	t.Parallel()
	keys := FileKeys{Health: newTestRing(t, "h1")}
	content := []byte("%PDF-1.4 attest")
	sealed, err := keys.seal("student-documents/4/a.pdf", FileRingHealth, content)
	if err != nil {
		t.Fatal(err)
	}
	for _, stored := range [][]byte{sealed, content, {}} {
		reader, err := keys.OpenStoredObject("student-documents/4/a.pdf", bytes.NewReader(stored))
		if err != nil {
			t.Fatal(err)
		}
		got, _ := io.ReadAll(reader)
		want := content
		if len(stored) == 0 {
			want = []byte{}
		}
		if !bytes.Equal(got, want) {
			t.Fatalf("got %q", got)
		}
	}
	if _, err := keys.OpenStoredObject("student-documents/5/a.pdf", bytes.NewReader(sealed)); !errors.Is(err, ErrSealedUnavailable) {
		t.Fatalf("export opened another school's object: %v", err)
	}
}
