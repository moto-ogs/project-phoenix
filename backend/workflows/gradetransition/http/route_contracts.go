package gradetransitionhttp

import "github.com/moto-ogs/project-phoenix/api/common"

// RouteContracts registers the Klassenwechsel administration (#2352), with
// patterns relative to /api/admin/grade-transitions.
func RouteContracts() []common.RouteContract {
	portals := []common.PortalScope{common.PortalTenant}
	transition := TransitionResponse{}
	result := TransitionResultResponse{}
	list := []common.QueryParam{
		{Name: "after_id", Kind: common.QueryID}, {Name: "page", Kind: common.QueryInt}, {Name: "page_size", Kind: common.QueryInt},
		{Name: "status", Kind: common.QueryString}, {Name: "academic_year", Kind: common.QueryString},
	}
	return []common.RouteContract{
		{Method: "GET", Pattern: "/", Portals: portals, Query: list, Response: []TransitionResponse{}, Paginated: true},
		{Method: "POST", Pattern: "/", Portals: portals, Request: TransitionRequest{}, Response: transition},
		{Method: "GET", Pattern: "/classes", Portals: portals, Response: []string{}},
		{Method: "GET", Pattern: "/suggest", Portals: portals, Response: []SuggestedMappingResponse{}},
		{Method: "PUT", Pattern: "/{id}/", Portals: portals, Request: TransitionRequest{}, Response: transition},
		{Method: "DELETE", Pattern: "/{id}/", Portals: portals, NoData: true},
		{Method: "GET", Pattern: "/{id}/preview", Portals: portals, Response: TransitionPreviewResponse{}},
		{Method: "GET", Pattern: "/{id}/history", Portals: portals, Response: []TransitionHistoryResponse{}},
		{Method: "POST", Pattern: "/{id}/apply", Portals: portals, Request: TransitionApplyRequest{}, Response: result},
		{Method: "POST", Pattern: "/{id}/revert", Portals: portals, Response: result},
	}
}
