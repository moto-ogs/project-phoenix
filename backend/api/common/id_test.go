package common_test

import (
	"encoding/json"
	"math"
	"testing"

	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestIDRendersAStringAndReadsBothForms(t *testing.T) {
	t.Parallel()

	type row struct {
		ID      common.ID   `json:"id"`
		Friends []common.ID `json:"friend_ids"`
		Parent  *common.ID  `json:"parent_id"`
	}
	data, err := json.Marshal(row{ID: math.MaxInt64, Friends: []common.ID{1, -2}})
	require.NoError(t, err)
	assert.JSONEq(t, `{"id":"9223372036854775807","friend_ids":["1","-2"],"parent_id":null}`, string(data))

	var read row
	require.NoError(t, json.Unmarshal([]byte(`{"id":"9223372036854775807","friend_ids":[3,"4"],"parent_id":null}`), &read))
	assert.Equal(t, int64(math.MaxInt64), read.ID.Int64())
	assert.Equal(t, []common.ID{3, 4}, read.Friends)
	assert.Nil(t, read.Parent)

	assert.Error(t, json.Unmarshal([]byte(`{"id":"7a"}`), &read))
	assert.Error(t, json.Unmarshal([]byte(`{"id":""}`), &read))
}
