package account

import (
	"errors"
	"net/http"

	"github.com/moto-ogs/project-phoenix/api/common"
)

// Token Management Endpoints

// cleanupExpiredTokens handles cleanup of expired tokens
func (rs *Resource) cleanupExpiredTokens(w http.ResponseWriter, r *http.Request) {
	if rs.Sessions == nil {
		common.RenderError(w, r, common.ErrorServiceUnavailable(errors.New("token cleanup unavailable")))
		return
	}
	count, err := rs.Sessions.CleanupExpiredTokens(r.Context())
	if err != nil {
		common.RenderError(w, r, common.ErrorInternalServer(err))
		return
	}

	response := map[string]int{"cleaned_tokens": count}
	common.Respond(w, r, http.StatusOK, response, "Expired tokens cleaned up successfully")
}

// revokeAllTokens revokes every session of the account (administrative
