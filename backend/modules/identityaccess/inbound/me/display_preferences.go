package me

import (
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/render"
	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess/sessiontoken"
)

var (
	errDisplayNotOwnSession  = errors.New("only the person's own session reads or changes its display preferences")
	errMoreContrastMissing   = errors.New("moreContrast must be true or false")
	displayPreferencePortals = []common.PortalScope{
		common.PortalTenant, common.PortalParent, common.PortalSchool,
		common.PortalTraeger, common.PortalCaterer, common.PortalOperator,
	}
)

// DisplayPreferencesResource serves the signed-in person's own display
// preferences ("Mehr Kontrast"). Every portal session reaches it, so the root
// mounts it once outside the portal routers. An operator session names an
// operator, every other session an account. A staff-view preview carries
// someone else's identity: it neither reads nor changes them.
type DisplayPreferencesResource struct {
	preferences identityaccess.AccountDisplayPreferences
}

// NewDisplayPreferencesResource builds the routes over the preferences
// capability.
func NewDisplayPreferencesResource(preferences identityaccess.AccountDisplayPreferences) *DisplayPreferencesResource {
	if preferences == nil {
		panic("display preferences resource: the preferences capability is required")
	}
	return &DisplayPreferencesResource{preferences: preferences}
}

// Router mounts GET / and PUT / behind the given session chain, which must
// authenticate the access token and block writes of a preview.
func (res *DisplayPreferencesResource) Router(configureSession func(chi.Router)) chi.Router {
	router := chi.NewRouter()
	configureSession(router)
	router.Get("/", res.get)
	router.Put("/", res.set)
	return router
}

// DisplayPreferencesRouteContracts registers the person's own display
// preferences (ADR 0270), with patterns relative to /display-preferences.
// The root mounts them outside the portal routers; each portal's proxy
// reaches them under its own BFF prefix.
func DisplayPreferencesRouteContracts() []common.RouteContract {
	return []common.RouteContract{
		{Method: "GET", Pattern: "/", Portals: displayPreferencePortals, Response: displayPreferencesResponse{}},
		{Method: "PUT", Pattern: "/", Portals: displayPreferencePortals, Request: displayPreferencesRequest{}, Response: displayPreferencesResponse{}},
	}
}

// displayPreferencesResponse is the wire shape: moreContrast is null while
// the person has not decided, and the browser follows the device.
type displayPreferencesResponse struct {
	MoreContrast *bool `json:"moreContrast"`
}

type displayPreferencesRequest struct {
	MoreContrast *bool `json:"moreContrast"`
}

func (req *displayPreferencesRequest) Bind(*http.Request) error {
	if req.MoreContrast == nil {
		return errMoreContrastMissing
	}
	return nil
}

// ownHolder returns the person of a real session: the operator of a
// platform session, otherwise the account.
func ownHolder(r *http.Request) (identityaccess.DisplayPreferenceHolder, bool) {
	claims := sessiontoken.ClaimsFromCtx(r.Context())
	if claims.ID <= 0 || claims.IsReadOnlyPreview() || claims.ActingAdminID != 0 {
		return identityaccess.DisplayPreferenceHolder{}, false
	}
	return identityaccess.DisplayPreferenceHolder{Operator: claims.IsPlatformScope(), ID: int64(claims.ID)}, true
}

func (res *DisplayPreferencesResource) get(w http.ResponseWriter, r *http.Request) {
	holder, ok := ownHolder(r)
	if !ok {
		common.RenderError(w, r, common.ErrorForbidden(errDisplayNotOwnSession))
		return
	}
	preferences, err := res.preferences.FindDisplayPreferences(r.Context(), holder)
	respondDisplayPreferences(w, r, preferences, err, "Display preferences retrieved successfully")
}

func (res *DisplayPreferencesResource) set(w http.ResponseWriter, r *http.Request) {
	holder, ok := ownHolder(r)
	if !ok {
		common.RenderError(w, r, common.ErrorForbidden(errDisplayNotOwnSession))
		return
	}
	req := &displayPreferencesRequest{}
	if err := render.Bind(r, req); err != nil {
		common.RenderError(w, r, common.ErrorInvalidRequest(err))
		return
	}
	preferences, err := res.preferences.SetMoreContrast(r.Context(), holder, *req.MoreContrast)
	respondDisplayPreferences(w, r, preferences, err, "Display preferences saved successfully")
}

func respondDisplayPreferences(w http.ResponseWriter, r *http.Request, preferences identityaccess.DisplayPreferences, err error, message string) {
	switch {
	case errors.Is(err, identityaccess.ErrAccountNotFound), errors.Is(err, identityaccess.ErrOperatorNotFound):
		common.RenderError(w, r, common.ErrorUnauthorized(err))
	case err != nil:
		common.RenderError(w, r, common.ErrorInternalServer(err))
	default:
		w.Header().Set("Cache-Control", "no-store")
		common.Respond(w, r, http.StatusOK, displayPreferencesResponse{MoreContrast: preferences.MoreContrast}, message)
	}
}
