package api

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/modules/workforce"
	substitutionsHTTP "github.com/moto-ogs/project-phoenix/modules/workforce/http/substitutions"
)

// newSubstitutionsResource wires /api/substitutions over the substitution
// operations capability.
func newSubstitutionsResource(substitutions substitutionsHTTP.Substitutions) *substitutionsHTTP.Resource {
	if substitutions == nil {
		panic("substitutions HTTP composition: all dependencies are required")
	}
	return substitutionsHTTP.NewResource(substitutions, substitutionsRuntime())
}

func substitutionsRuntime() substitutionsHTTP.Runtime {
	return substitutionsHTTP.Runtime{
		Protected: func(router chi.Router, routes func(chi.Router, substitutionsHTTP.Middleware)) {
			ProtectedTenantRoutes(router, routes)
		},
		Caller:  substitutionsHTTP.RequestCaller,
		Success: common.Respond,
		Failure: renderSubstitutionsFailure,
	}
}

// renderSubstitutionsFailure renders the stable status, code and message the
// adapter classified; the underlying error only reaches the log.
func renderSubstitutionsFailure(w http.ResponseWriter, r *http.Request, failure substitutionsHTTP.Failure) {
	resp := &common.ErrResponse{
		Err: failure.Err, HTTPStatusCode: failure.Status, Detail: failure.Message, Code: failure.Code,
		Details: failure.Details,
	}
	if failure.Field != "" {
		resp.Errors = []common.FieldError{{Field: failure.Field, Reason: failure.Message}}
	}
	common.RenderError(w, r, resp)
}

// substitutionRouteContracts registers the substitutions of the staff portal
// (#2352), with patterns relative to /api/substitutions. Workforce's http
// role may not import the contract types; it hands over its bodies.
func substitutionRouteContracts() []common.RouteContract {
	types := substitutionsHTTP.RouteContractTypes()
	portals := []common.PortalScope{common.PortalTenant}
	overview := []common.QueryParam{
		{Name: "group_id", Kind: common.QueryID}, {Name: "active_group_id", Kind: common.QueryID},
		{Name: "date", Kind: common.QueryDate}, {Name: "from", Kind: common.QueryDate}, {Name: "to", Kind: common.QueryDate},
	}
	return []common.RouteContract{
		{Method: "GET", Pattern: "/", Portals: portals, Query: overview, Response: types.Overview},
		{Method: "POST", Pattern: "/", Portals: portals, Request: types.AssignmentRequest, Response: types.Assignment, Enums: []common.EnumContract{{
			Name: "SubstitutionAnswerKind", Fields: []string{"SubstitutionAssignmentResponse.type"},
			Values: []string{string(workforce.TargetGroupHandover), string(workforce.TargetAdditionalSupervision), string(workforce.TargetScheduleSubstitution)},
		}}},
		{Method: "POST", Pattern: "/end", Portals: portals, Request: types.EndRequest, Response: types.End},
	}
}
