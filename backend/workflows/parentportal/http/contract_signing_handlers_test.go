package parent

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	parentService "github.com/moto-ogs/project-phoenix/workflows/parentportal"
)

// A signature the Träger's missing letterhead holds back answers 409 with
// the parents' code, as on the public link, never a 500 (#7177).
func TestContractSigningWithoutALetterheadAnswersItsCode(t *testing.T) {
	t.Parallel()
	w := httptest.NewRecorder()
	renderContractSigningError(w, httptest.NewRequest(http.MethodPost, "/parent/me/documents/4/contracts/31/sign", nil),
		fmt.Errorf("%w: letterhead", parentService.ErrContractLetterheadMissing))
	require.Equal(t, http.StatusConflict, w.Code, w.Body.String())
	var body struct {
		Code string `json:"code"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &body))
	assert.Equal(t, "care_contract.signing_letterhead_missing", body.Code)
}
