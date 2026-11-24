package wire_test

import (
	"encoding/json"
	"math"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident/wire"
)

func TestIDAnswersAStringStoresANumberAndReadsBothForms(t *testing.T) {
	t.Parallel()

	type row struct {
		ID      ident.ID   `json:"id"`
		Friends []ident.ID `json:"friend_ids"`
		Parent  *ident.ID  `json:"parent_id"`
	}
	value := row{ID: math.MaxInt64, Friends: []ident.ID{1, -2}}
	answer, err := wire.Marshal(value)
	require.NoError(t, err)
	assert.JSONEq(t, `{"id":"9223372036854775807","friend_ids":["1","-2"],"parent_id":null}`, string(answer))

	// Stored JSON keeps numbers: database functions compare them as numbers.
	stored, err := json.Marshal(value)
	require.NoError(t, err)
	assert.JSONEq(t, `{"id":9223372036854775807,"friend_ids":[1,-2],"parent_id":null}`, string(stored))

	// The answer encodes everything else exactly as encoding/json does,
	// identifiers inside an any included.
	mixed := map[string]any{"html": "<b>&</b>", "ids": []ident.ID{5}, "nil": []string(nil), "at": &value.ID}
	plain, err := json.Marshal(mixed)
	require.NoError(t, err)
	wire, err := wire.Marshal(mixed)
	require.NoError(t, err)
	assert.Equal(t, strings.NewReplacer(`[5]`, `["5"]`, `9223372036854775807`, `"9223372036854775807"`).Replace(string(plain)), string(wire))

	var read row
	require.NoError(t, json.Unmarshal([]byte(`{"id":"9223372036854775807","friend_ids":[3,"4"],"parent_id":null}`), &read))
	assert.Equal(t, int64(math.MaxInt64), read.ID.Int64())
	assert.Equal(t, []ident.ID{3, 4}, read.Friends)
	assert.Nil(t, read.Parent)

	assert.Error(t, json.Unmarshal([]byte(`{"id":"7a"}`), &read))
	assert.Error(t, json.Unmarshal([]byte(`{"id":""}`), &read))
}

func TestRequestIDsAreStringsButDeviceIDsAreNumbers(t *testing.T) {
	t.Parallel()

	var request struct {
		ContractIDs []ident.ID `json:"contract_ids"`
		RoomID      int64      `json:"room_id" contract:"number"`
	}
	require.NoError(t, wire.Decode(strings.NewReader(`{"contract_ids":["9223372036854775807"],"room_id":3}`), &request))
	assert.Equal(t, []ident.ID{math.MaxInt64}, request.ContractIDs)
	assert.EqualValues(t, 3, request.RoomID)

	require.ErrorContains(t, wire.Decode(strings.NewReader(`{"contract_ids":[9223372036854775807]}`), &request), "identifier must be a decimal string")
	require.NoError(t, json.Unmarshal([]byte(`{"contract_ids":[9223372036854775807]}`), &request))
	assert.Equal(t, []ident.ID{math.MaxInt64}, request.ContractIDs)
}

func TestRequiredIDsDistinguishNullFromZero(t *testing.T) {
	t.Parallel()

	var request struct {
		IDs        []ident.ID `json:"ids"`
		OptionalID *ident.ID  `json:"optional_id"`
	}
	dec := wire.NewDecoder(strings.NewReader(`{"ids":["0"],"optional_id":null}`))
	require.NoError(t, dec.DecodeWithRequiredIDs(&request))
	assert.Equal(t, []ident.ID{0}, request.IDs)
	assert.Nil(t, request.OptionalID)

	dec = wire.NewDecoder(strings.NewReader(`{"ids":[null]}`))
	err := dec.DecodeWithRequiredIDs(&request)
	require.Error(t, err)
	assert.True(t, wire.InvalidIDAt(err, "/ids"))
}
