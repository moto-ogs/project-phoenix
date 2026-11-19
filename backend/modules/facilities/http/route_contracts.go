package httpadapter

import apiCommon "github.com/moto-ogs/project-phoenix/api/common"

// RouteContracts registers the typed contract of the room routes the staff
// portal reaches through its proxy (ADR 0270), with patterns relative to
// /api/rooms.
func RouteContracts() []apiCommon.RouteContract {
	portals := []apiCommon.PortalScope{apiCommon.PortalTenant}
	category := []apiCommon.QueryParam{{Name: "category", Kind: apiCommon.QueryString}}
	return []apiCommon.RouteContract{
		{Method: "GET", Pattern: "/by-category", Portals: portals, Query: category, Response: []RoomResponse{}},
		{Method: "GET", Pattern: "/{id}/removal-impact", Portals: portals, Response: RoomRemovalImpactResponse{}},
	}
}
