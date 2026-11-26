package portalauth

import (
	"context"
	"errors"
	"net/http"

	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident/wire"
)

var (
	errPasswordRequired     = errors.New("current_password is required")
	errCurrentPasswordWrong = errors.New("current password is incorrect")
)

// SwitchOffRequest is the body of a voluntary factor's switch-off.
type SwitchOffRequest struct {
	CurrentPassword string `json:"current_password"`
}

// SwitchOffFactor switches a voluntary second factor off once the owner
// checked the current password. A wrong password answers on its field, like
// the password change.
func SwitchOffFactor(w http.ResponseWriter, r *http.Request, disable func(ctx context.Context, currentPassword string, client Client) error, refuse Refusal) {
	var request SwitchOffRequest
	if err := wire.Decode(r.Body, &request); err != nil || request.CurrentPassword == "" {
		common.RenderError(w, r, common.ErrorInvalidRequest(errPasswordRequired))
		return
	}
	err := disable(r.Context(), request.CurrentPassword, ClientOf(r))
	switch {
	case err == nil:
		common.RespondNoContent(w, r)
	case errors.Is(err, identityaccess.ErrInvalidCredentials):
		common.RenderError(w, r, common.ErrorUnauthorizedOnField(errCurrentPasswordWrong, common.CodeIdentityCurrentPasswordWrong, "current_password"))
	default:
		refuse(w, r, err)
	}
}
