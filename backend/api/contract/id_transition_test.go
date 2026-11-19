package contract

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type idTransitionResponse struct {
	ID     wireID `json:"id" contract:"legacy-id"`
	Strict wireID `json:"strict"`
}

type invalidIDTransitionResponse struct {
	ID string `json:"id" contract:"legacy-id"`
}

func TestIDTransitionDecoder(t *testing.T) {
	t.Parallel()
	doc, err := Build([]Registration{get("/api/transition/", idTransitionResponse{})}, Options{Identifiers: identifiers})
	require.NoError(t, err)
	fields := fieldsOf(t, doc, "idTransitionResponse")
	assert.Equal(t, KindLegacyID, fields["id"].Schema.Kind)
	assert.Equal(t, KindID, fields["strict"].Schema.Kind)
	files, err := TypeScript(doc)
	require.NoError(t, err)
	assert.Contains(t, files["transition.generated.ts"], "  id: string;")
	assert.Contains(t, files["transition.generated.ts"], "  id: int64StringOrNumber,")
	assert.Contains(t, files["transition.generated.ts"], "  strict: int64String,")
}

func TestIDTransitionRequiresResponseIdentifier(t *testing.T) {
	t.Parallel()
	for name, route := range map[string]Registration{
		"request":        post(idTransitionResponse{}),
		"non-identifier": get("/api/transition/", invalidIDTransitionResponse{}),
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			_, err := Build([]Registration{route}, Options{Identifiers: identifiers})
			assert.ErrorContains(t, err, `contract:"legacy-id" needs an ID response field`)
		})
	}
}
