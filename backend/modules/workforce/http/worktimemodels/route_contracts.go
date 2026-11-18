package worktimemodels

import "github.com/moto-ogs/project-phoenix/api/common"

// DeletedResponse names the template a delete removed.
type DeletedResponse struct {
	ID int64 `json:"id"`
}

// RouteContracts registers the typed contract of the work-time templates
// (ADR 0270), with patterns relative to /api/work-time-models.
func RouteContracts() []common.RouteContract {
	portals := []common.PortalScope{common.PortalTenant}
	withUsage := []common.QueryParam{{Name: "with_usage", Kind: common.QueryBool}}
	return []common.RouteContract{
		{Method: "GET", Pattern: "/", Portals: portals, Query: withUsage, Response: []ModelResponse{}},
		{Method: "GET", Pattern: "/staff-facts", Portals: portals, Response: []StaffFactResponse{}},
		{Method: "GET", Pattern: "/{id}", Portals: portals, Response: ModelResponse{}},
		{Method: "POST", Pattern: "/", Portals: portals, Request: ModelRequest{}, Response: ModelResponse{}},
		{Method: "PUT", Pattern: "/{id}", Portals: portals, Request: ModelRequest{}, Response: ModelResponse{}},
		{Method: "DELETE", Pattern: "/{id}", Portals: portals, Response: DeletedResponse{}},
		{Method: "POST", Pattern: "/{id}/archive", Portals: portals, Response: ModelResponse{}},
		{Method: "POST", Pattern: "/{id}/restore", Portals: portals, Response: ModelResponse{}},
		{Method: "POST", Pattern: "/{id}/assignments", Portals: portals, Request: AssignRequest{}, Response: AssignResponse{}},
	}
}
