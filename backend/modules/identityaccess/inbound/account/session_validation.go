package account

import (
	"errors"
	"net/http"

	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess/inbound/portalauth"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident/wire"

	"github.com/go-chi/render"
)

// SessionValidationRequest names the tokens of a session and the portal
// that shows it.
type SessionValidationRequest struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	Portal       string `json:"portal"`
}

// SessionClaimsResponse is the validated claims in the access token's claim
// shape; its identifiers travel as strings (ADR 0300).
type SessionClaimsResponse struct {
	ID            ident.ID `json:"id,omitempty"`
	Sub           string   `json:"sub,omitempty"`
	Username      string   `json:"username,omitempty"`
	FirstName     string   `json:"first_name,omitempty"`
	LastName      string   `json:"last_name,omitempty"`
	Roles         []string `json:"roles,omitempty"`
	Permissions   []string `json:"permissions,omitempty"`
	IsAdmin       bool     `json:"is_admin,omitempty"`
	Scope         string   `json:"scope,omitempty"`
	TenantID      ident.ID `json:"tenant_id,omitempty"`
	OrgID         ident.ID `json:"org_id,omitempty"`
	FamilyID      string   `json:"family_id,omitempty"`
	ReadOnly      bool     `json:"read_only,omitempty"`
	ActingAdminID ident.ID `json:"acting_admin_id,omitempty"`
	PreviewID     string   `json:"preview_id,omitempty"`
	ViaTraeger    bool     `json:"via_traeger,omitempty"`
	ExpiresAt     int64    `json:"exp,omitempty" contract:"number"`
}

func (rs *Resource) validateSession(w http.ResponseWriter, r *http.Request) {
	var input SessionValidationRequest
	r.Body = http.MaxBytesReader(w, r.Body, 32*1024)
	if err := wire.Decode(r.Body, &input); err != nil {
		common.RenderError(w, r, common.ErrorInvalidRequest(errors.New("invalid session validation request")))
		return
	}
	if rs.Sessions == nil {
		common.RenderError(w, r, common.ErrorServiceUnavailable(errors.New("session validation unavailable")))
		return
	}
	claims, err := rs.Sessions.ValidateSessionTokens(r.Context(), input.AccessToken, input.RefreshToken, input.Portal)
	if err != nil {
		// A refusal answers as the refresh would. A read that could not run
		// is 503 (#5399): the BFF keeps the session it shows and writes no
		// cookie, but does not end it on a hiccup.
		common.RenderError(w, r, portalauth.RendererOr(err, validationUnavailable, portalauth.RenewalRules))
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	common.RenderJSON(w, r, sessionClaimsResponse(claims))
}

// sessionClaimsResponse renders the validated claims in the access-token
// claim shape the frontend hand-off consumes.
func sessionClaimsResponse(claims identityaccess.SessionClaims) SessionClaimsResponse {
	return SessionClaimsResponse{
		ID: ident.ID(claims.AccountID), Sub: claims.Email, Username: claims.Username, FirstName: claims.FirstName, LastName: claims.LastName,
		Roles: claims.Roles, Permissions: claims.Permissions, IsAdmin: claims.IsAdmin, Scope: claims.Scope,
		TenantID: ident.ID(claims.TenantID), OrgID: ident.ID(claims.OrgID), FamilyID: claims.FamilyID,
		ReadOnly: claims.ReadOnly, ActingAdminID: ident.ID(claims.ActingAdminID), PreviewID: claims.PreviewID, ViaTraeger: claims.ViaTraeger,
		ExpiresAt: claims.ExpiresAt,
	}
}

func validationUnavailable(error) render.Renderer {
	return common.ErrorServiceUnavailable(errors.New("session validation unavailable"))
}
