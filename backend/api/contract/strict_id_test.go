package contract

import (
	"reflect"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type strictAnswer struct {
	ID      wireID   `json:"id"`
	Friends []wireID `json:"friend_ids"`
}

type laxAnswer struct {
	ID laxID `json:"id"`
}

type laxListAnswer struct {
	IDs []laxID `json:"ids"`
}

type intAnswer struct {
	RoomID int `json:"room_id"`
}

type numberAnswer struct {
	GroupIDs []int64 `json:"group_ids" contract:"number"`
}

type untaggedCentsAnswer struct {
	PriceCents int64 `json:"price_cents"`
}

type bareAnswer struct {
	ID int64 `json:"id"`
}

// TestAnAnswerIdentifierIsOnlyAString holds the end of #2342 phase 2 (ADR
// 0300): every identifier of an answer decodes from a decimal string and
// nothing else, and the generator has no way left to write a number.
func TestAnAnswerIdentifierIsOnlyAString(t *testing.T) {
	t.Parallel()
	doc, err := Build([]Registration{get("/api/strict/", strictAnswer{})}, Options{Identifiers: identifiers})
	require.NoError(t, err)
	files, err := TypeScript(doc)
	require.NoError(t, err)
	source := files["strict.generated.ts"]
	assert.Contains(t, source, "  id: int64String,")
	assert.Contains(t, source, "  friend_ids: nullable(arr(int64String)),")
	assert.NotContains(t, source, "int64StringOrNumber", "no answer decoder takes a number")

	readers := map[reflect.Type]string{reflect.TypeFor[ownReader](): ReadsLaxIDs}
	for name, test := range map[string]struct {
		answer any
		want   string
	}{
		"a lax identifier type":        {laxAnswer{}, "a reader of numbers belongs to a request"},
		"a list of lax identifiers":    {laxListAnswer{}, "a reader of numbers belongs to a request"},
		"a numeric reader as answer":   {ownReader{}, "a reader of numbers belongs to a request"},
		"a bare int64 without a claim": {bareAnswer{}, "int64 does not say what it is"},
		"an int under an id name":      {intAnswer{}, `"room_id" names an identifier but is a number`},
		"a number under an id name":    {numberAnswer{}, `"group_ids" names an identifier but is a number`},
		"an amount without its tag":    {untaggedCentsAnswer{}, "int64 does not say what it is"},
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			_, err := Build([]Registration{get("/api/strict/", test.answer)}, Options{Identifiers: identifiers, Readers: readers})
			assert.ErrorContains(t, err, test.want)
		})
	}
}

// TestTheJSONStringOptionMakesNoIdentifier feeds the generator the option
// ,string as the walk hands it over, so no Go file of the backend has to
// carry the tag (test/json_string_option_ratchet_test.go).
func TestTheJSONStringOptionMakesNoIdentifier(t *testing.T) {
	t.Parallel()
	for name, answer := range map[string]reflect.Type{
		"a bare int64":  reflect.TypeFor[bareAnswer](),
		"an identifier": reflect.TypeFor[strictAnswer](),
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			b := &builder{identifiers: identifiers}
			_, err := b.field(answer, answer, answer.Field(0), "id", []string{"string"}, "GET /api/strict/", false)
			assert.ErrorContains(t, err, "the json option ,string does not make an identifier")
		})
	}
}
