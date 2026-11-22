package ident_test

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

func TestID_AcceptsNumberAndString(t *testing.T) {
	t.Parallel()

	var payload struct {
		ID ident.ID `json:"id"`
	}

	require.NoError(t, json.Unmarshal([]byte(`{"id": 42}`), &payload))
	assert.Equal(t, int64(42), payload.ID.Int64())

	payload.ID = 0
	require.NoError(t, json.Unmarshal([]byte(`{"id": "42"}`), &payload))
	assert.Equal(t, int64(42), payload.ID.Int64())
}

// The whole reason this type exists: 2^53 + 1 is a valid bigint that a JSON
// number cannot carry through JavaScript — it arrives as 2^53, a perfectly
// valid id for a different row. As a string the digits survive.
func TestID_KeepsBigintPrecisionFromString(t *testing.T) {
	t.Parallel()

	var payload struct {
		ID ident.ID `json:"id"`
	}

	require.NoError(t, json.Unmarshal([]byte(`{"id": "9007199254740993"}`), &payload))
	assert.Equal(t, int64(9007199254740993), payload.ID.Int64())
}

func TestID_RejectsNonIntegerStrings(t *testing.T) {
	t.Parallel()

	for _, raw := range []string{`{"id": "abc"}`, `{"id": ""}`, `{"id": "1.5"}`, `{"id": " "}`} {
		var payload struct {
			ID ident.ID `json:"id"`
		}
		assert.Error(t, json.Unmarshal([]byte(raw), &payload), "payload %s must not decode", raw)
	}
}

// Absent and null leave the zero value, which every Bind() rejects as "id is
// required" — the same answer a missing field gave before.
func TestID_NullAndMissingStayZero(t *testing.T) {
	t.Parallel()

	var payload struct {
		ID ident.ID `json:"id"`
	}

	require.NoError(t, json.Unmarshal([]byte(`{"id": null}`), &payload))
	assert.Zero(t, payload.ID.Int64())

	require.NoError(t, json.Unmarshal([]byte(`{}`), &payload))
	assert.Zero(t, payload.ID.Int64())
}

// Negative ids decode rather than error, so the caller's own validation gets to
// produce its message instead of a JSON parse failure.
func TestID_NegativeDecodesForCallerValidation(t *testing.T) {
	t.Parallel()

	var payload struct {
		ID ident.ID `json:"id"`
	}

	require.NoError(t, json.Unmarshal([]byte(`{"id": -1}`), &payload))
	assert.Equal(t, int64(-1), payload.ID.Int64())
}

// encoding/json writes a number, so stored JSON, fingerprints and database
// triggers keep their shape; answers go through package wire (ADR 0300).
func TestID_MarshalsAsNumber(t *testing.T) {
	t.Parallel()

	payload := struct {
		ID ident.ID `json:"id"`
	}{ID: ident.ID(9007199254740993)}

	encoded, err := json.Marshal(payload)
	require.NoError(t, err)
	assert.JSONEq(t, `{"id": 9007199254740993}`, string(encoded))
}
