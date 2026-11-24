package common

import (
	"encoding/json"
	"testing"

	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
	"github.com/stretchr/testify/require"
)

func TestJSONWrappersKeepIdentifiersStrict(t *testing.T) {
	t.Parallel()

	type value struct {
		ID ident.ID `json:"id"`
	}
	const numeric = `{"id":9007199254740993}`
	const textual = `{"id":"9007199254740993"}`

	var optional OptionalJSON[value]
	require.Error(t, json.Unmarshal([]byte(numeric), &optional))
	require.True(t, optional.IsZero())
	require.NoError(t, json.Unmarshal([]byte(textual), &optional))
	require.Equal(t, ident.ID(9007199254740993), optional.Value.ID)
	encoded, err := json.Marshal(optional)
	require.NoError(t, err)
	require.JSONEq(t, textual, string(encoded))

	var deferred DeferredJSON[value]
	require.NoError(t, json.Unmarshal([]byte(numeric), &deferred))
	require.True(t, deferred.Present)
	require.Equal(t, json.RawMessage(numeric), deferred.Invalid)
	require.NoError(t, json.Unmarshal([]byte(textual), &deferred))
	require.True(t, deferred.Present)
	require.Empty(t, deferred.Invalid)
	require.Equal(t, optional.Value, deferred.Value)
}
