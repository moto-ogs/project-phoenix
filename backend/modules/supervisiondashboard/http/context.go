package supervisiondashboardhttp

import (
	"context"
	"errors"
	"net/http"
	"net/url"

	"github.com/go-chi/chi/v5"
	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/auth/authorize/permissions"
	"github.com/moto-ogs/project-phoenix/modules/supervisiondashboard"
)

const (
	sectionGroups        = "groups"
	sectionSessions      = "sessions"
	sectionReleasedRooms = "released-rooms"
)

func RouteContracts() []common.RouteContract {
	return []common.RouteContract{{
		Method: http.MethodGet, Pattern: "/supervision-context", Portals: []common.PortalScope{common.PortalTenant},
		Query: []common.QueryParam{{Name: "section", Kind: common.QueryString, Repeated: true,
			Values: []string{sectionGroups, sectionSessions, sectionReleasedRooms}}},
		Response: supervisiondashboard.NavigationContext{},
		Enums: []common.EnumContract{{Name: "ContextStatus", Type: supervisiondashboard.ContextStatus(""), Values: []string{
			string(supervisiondashboard.ContextOK), string(supervisiondashboard.ContextForbidden), string(supervisiondashboard.ContextUnavailable),
		}}},
	}}
}

type ContextResource struct {
	Read func(context.Context, supervisiondashboard.ContextSections) (supervisiondashboard.NavigationContext, error)
}

func (rs ContextResource) Register(r chi.Router, withTx common.Middleware) {
	r.With(requireStaffPortal, withTx).Get("/supervision-context", rs.get)
}

// The enclosing tenant gate also admits operator tokens. This read requires
// a school-bound staff-portal session before entering the school transaction.
func requireStaffPortal(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		principal, err := common.CurrentPrincipal(r.Context())
		if err != nil || principal.Scope() != permissions.ScopeTenant || principal.TenantID() <= 0 {
			common.RenderError(w, r, common.ErrorUnauthorized(permissions.ErrPrincipalRequired))
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (rs ContextResource) get(w http.ResponseWriter, r *http.Request) {
	query, err := url.ParseQuery(r.URL.RawQuery)
	if err != nil {
		common.RenderError(w, r, common.ErrorInvalidRequest(err))
		return
	}
	sections, err := contextSections(query["section"])
	if err != nil {
		common.RenderError(w, r, common.ErrorInvalidRequest(err))
		return
	}
	result, err := rs.Read(r.Context(), sections)
	if err != nil {
		common.RenderError(w, r, common.ErrorInternalServerWrap("failed to read supervision context", err))
		return
	}
	common.Respond(w, r, http.StatusOK, result, "Supervision context retrieved successfully")
}

func contextSections(values []string) (supervisiondashboard.ContextSections, error) {
	var sections supervisiondashboard.ContextSections
	if len(values) == 0 {
		return supervisiondashboard.ContextSections{Groups: true, Sessions: true, ReleasedRooms: true}, nil
	}
	for _, value := range values {
		switch value {
		case sectionGroups:
			sections.Groups = true
		case sectionSessions:
			sections.Sessions = true
		case sectionReleasedRooms:
			sections.ReleasedRooms = true
		default:
			return sections, errors.New("invalid supervision context section")
		}
	}
	return sections, nil
}
