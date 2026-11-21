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
	Quoted  int64    `json:"quoted_id,string"`
}

type laxAnswer struct {
	ID laxID `json:"id"`
}

type laxListAnswer struct {
	IDs []laxID `json:"ids"`
}

type taggedAnswer struct {
	ID wireID `json:"id" contract:"legacy-id"`
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
	assert.Contains(t, source, "  quoted_id: int64String,")
	assert.NotContains(t, source, "int64StringOrNumber", "no answer decoder takes a number")

	readers := map[reflect.Type]string{reflect.TypeFor[ownReader](): ReadsLaxIDs}
	for name, test := range map[string]struct {
		answer any
		want   string
	}{
		"a lax identifier type":        {laxAnswer{}, "a reader of numbers belongs to a request"},
		"a list of lax identifiers":    {laxListAnswer{}, "a reader of numbers belongs to a request"},
		"a numeric reader as answer":   {ownReader{}, "a reader of numbers belongs to a request"},
		"the retired legacy-id tag":    {taggedAnswer{}, `contract:"legacy-id"`},
		"a bare int64 without a claim": {bareAnswer{}, "int64 does not say what it is"},
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			_, err := Build([]Registration{get("/api/strict/", test.answer)}, Options{Identifiers: identifiers, Readers: readers})
			assert.ErrorContains(t, err, test.want)
		})
	}
}
