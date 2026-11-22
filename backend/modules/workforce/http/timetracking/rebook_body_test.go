package timetracking

import (
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Browser clients send the absence identifiers of a rebooking as decimal
// strings; numbers are accepted too (#3258).
func TestDecodeRebookAbsences(t *testing.T) {
	t.Parallel()
	decode := func(body string) (int, error) {
		req, err := decodeRebookAbsences(httptest.NewRequest("POST", "/", strings.NewReader(body)))
		if err == nil {
			assert.Equal(t, []int64{7, 8}, req.AbsenceIDs)
			require.NotNil(t, req.AbsenceTypeID)
			assert.Equal(t, int64(9007199254740995), *req.AbsenceTypeID)
			assert.Equal(t, "Kontingent angelegt", req.Reason)
			assert.True(t, req.DryRun)
		}
		return len(req.AbsenceIDs), err
	}

	count, err := decode(`{"absence_ids":["7",8],"absence_type":"other","absence_type_id":"9007199254740995","reason":"Kontingent angelegt","dry_run":true}`)
	require.NoError(t, err)
	assert.Equal(t, 2, count)

	for _, malformed := range []string{`{"absence_ids":["x"]}`, `{"absence_ids":[null]}`, `{"absence_type_id":"1.5"}`} {
		_, err := decode(malformed)
		require.Error(t, err, malformed)
	}
}
