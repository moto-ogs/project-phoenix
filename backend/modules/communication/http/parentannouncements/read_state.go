package announcement

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"

	"github.com/moto-ogs/project-phoenix/api/common"
)

// versionRequest carries the version of the state a command acts on: a
// publication sends the version of the draft it publishes (ADR 0311).
type versionRequest struct {
	ExpectedVersion string `json:"expected_version"`
}

// fingerprintRequest confirms the delete dialog whose fingerprint it carries.
type fingerprintRequest struct {
	ExpectedFingerprint string `json:"expected_fingerprint"`
}

// decodeReadState reads the token body of a command. A missing body is an
// empty token, which the owner refuses as a changed state.
func decodeReadState(w http.ResponseWriter, r *http.Request, dst any) bool {
	if err := json.NewDecoder(r.Body).Decode(dst); err != nil && !errors.Is(err, io.EOF) {
		common.RenderError(w, r, common.ErrorInvalidRequest(errors.New("invalid request body")))
		return false
	}
	return true
}
