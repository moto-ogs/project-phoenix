package studentpresencehttp_test

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/require"

	testpkg "github.com/moto-ogs/project-phoenix/test"
)

func partialAbsenceResponseID(t *testing.T, body []byte) int64 {
	t.Helper()
	var response struct {
		Data struct {
			ID testpkg.ID `json:"id"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(body, &response))
	require.Positive(t, response.Data.ID)
	return int64(response.Data.ID)
}
