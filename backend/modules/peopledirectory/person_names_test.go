package peopledirectory

import (
	"errors"
	"strings"
	"testing"
)

// A name limit counts characters, not bytes (#7379): 200 umlauts take 400
// bytes and still fit, 201 characters do not.
func TestNormalizePersonCreateCountsNameCharacters(t *testing.T) {
	t.Parallel()
	umlauts := strings.Repeat("ü", MaxNameLength)
	if _, err := NormalizePersonCreate(CreatePerson{FirstName: umlauts, LastName: "Keller"}); err != nil {
		t.Fatalf("200 umlauts: %v, want accepted", err)
	}
	_, err := NormalizePersonCreate(CreatePerson{FirstName: umlauts + "a", LastName: "Keller"})
	if !errors.Is(err, ErrInvalidPerson) {
		t.Fatalf("201 characters: %v, want ErrInvalidPerson", err)
	}
}
