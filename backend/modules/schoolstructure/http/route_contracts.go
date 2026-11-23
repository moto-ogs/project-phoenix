package schoolstructurehttp

import "github.com/moto-ogs/project-phoenix/api/common"

// RouteContracts registers the group administration of the staff portal
// (#2352), with patterns relative to /api/groups.
func RouteContracts() []common.RouteContract {
	portals := []common.PortalScope{common.PortalTenant}
	list := []common.QueryParam{
		{Name: "name", Kind: common.QueryString}, {Name: "room_id", Kind: common.QueryID},
		{Name: "page", Kind: common.QueryInt}, {Name: "page_size", Kind: common.QueryInt},
	}
	return []common.RouteContract{
		{Method: "GET", Pattern: "/", Portals: portals, Query: list, Response: []GroupResponse{}, Paginated: true},
		{Method: "POST", Pattern: "/", Portals: portals, Request: GroupRequest{}, Response: GroupResponse{}},
		{Method: "GET", Pattern: "/{id}", Portals: portals, Response: GroupResponse{}},
		{Method: "PUT", Pattern: "/{id}", Portals: portals, Request: GroupUpdateRequest{}, Response: GroupResponse{}},
		{Method: "DELETE", Pattern: "/{id}", Portals: portals, NoData: true},
	}
}
