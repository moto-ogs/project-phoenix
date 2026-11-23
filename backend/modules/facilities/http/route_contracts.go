package httpadapter

import apiCommon "github.com/moto-ogs/project-phoenix/api/common"

// RouteContracts registers the typed contract of the room routes the staff
// portal reaches through its proxy (ADR 0270), with patterns relative to
// /api/rooms. The export answers a file that streams through the proxy.
func RouteContracts() []apiCommon.RouteContract {
	portals := []apiCommon.PortalScope{apiCommon.PortalTenant}
	category := []apiCommon.QueryParam{{Name: "category", Kind: apiCommon.QueryString}}
	list := []apiCommon.QueryParam{
		{Name: "building", Kind: apiCommon.QueryString},
		{Name: "category", Kind: apiCommon.QueryString},
		{Name: "is_open_room", Kind: apiCommon.QueryBool},
		{Name: "include_system", Kind: apiCommon.QueryBool},
		{Name: "page", Kind: apiCommon.QueryInt},
		{Name: "page_size", Kind: apiCommon.QueryInt},
	}
	window := []apiCommon.QueryParam{{Name: "start", Kind: apiCommon.QueryString}, {Name: "end", Kind: apiCommon.QueryString}}
	return []apiCommon.RouteContract{
		{Method: "GET", Pattern: "/", Portals: portals, Query: list, Paginated: true, Response: []RoomResponse{}},
		{Method: "POST", Pattern: "/", Portals: portals, Request: RoomRequest{}, Response: RoomResponse{}},
		{Method: "GET", Pattern: "/by-category", Portals: portals, Query: category, Response: []RoomResponse{}, Deprecated: true},
		{Method: "GET", Pattern: "/{id}", Portals: portals, Response: RoomResponse{}},
		{Method: "PUT", Pattern: "/{id}", Portals: portals, Request: RoomRequest{}, Response: RoomResponse{}},
		{Method: "DELETE", Pattern: "/{id}", Portals: portals, Request: RoomRemovalRequest{}, Response: RoomRemovalResponse{}},
		{Method: "GET", Pattern: "/{id}/history", Portals: portals, Query: window, Response: []RoomSessionEntry{}},
		{Method: "GET", Pattern: "/{id}/removal-impact", Portals: portals, Response: RoomRemovalImpactResponse{}},
		{Method: "POST", Pattern: "/export", Portals: portals, Request: roomSnapshotExportRequest{}, File: true},
	}
}
