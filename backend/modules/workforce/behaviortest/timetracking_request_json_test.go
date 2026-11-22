package workforce_test

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/modules/workforce"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

// Browser clients send BIGINT identifiers as decimal strings (#3258); the
// handlers decode these public request types directly.
func TestAbsenceRequestsAcceptDecimalStringIDs(t *testing.T) {
	t.Parallel()

	t.Run("create", func(t *testing.T) {
		t.Parallel()
		var req workforce.CreateAbsenceRequest
		require.NoError(t, json.Unmarshal([]byte(`{"absence_type":"other","absence_type_id":"9007199254740993","date_start":"2026-08-07","date_end":"2026-08-07"}`), &req))
		require.NotNil(t, req.AbsenceTypeID)
		assert.Equal(t, ident.ID(9007199254740993), *req.AbsenceTypeID)
		assert.Equal(t, "2026-08-07", req.DateStart)
		require.Error(t, json.Unmarshal([]byte(`{"absence_type_id":"1.5"}`), &req))
	})

	t.Run("update keeps null apart from omitted", func(t *testing.T) {
		t.Parallel()
		var cleared workforce.UpdateAbsenceRequest
		require.NoError(t, json.Unmarshal([]byte(`{"absence_type":"training","absence_type_id":null}`), &cleared))
		assert.True(t, cleared.AbsenceTypeIDSet)
		assert.Nil(t, cleared.AbsenceTypeID)
		require.NotNil(t, cleared.AbsenceType)
		assert.Equal(t, "training", *cleared.AbsenceType)

		var omitted workforce.UpdateAbsenceRequest
		require.NoError(t, json.Unmarshal([]byte(`{"note":"x"}`), &omitted))
		assert.False(t, omitted.AbsenceTypeIDSet)
		require.NotNil(t, omitted.Note)

		var named workforce.UpdateAbsenceRequest
		require.NoError(t, json.Unmarshal([]byte(`{"absence_type_id":"12"}`), &named))
		assert.True(t, named.AbsenceTypeIDSet)
		require.NotNil(t, named.AbsenceTypeID)
		assert.Equal(t, ident.ID(12), *named.AbsenceTypeID)
		require.Error(t, json.Unmarshal([]byte(`{"absence_type_id":"x"}`), &named))
	})
}
