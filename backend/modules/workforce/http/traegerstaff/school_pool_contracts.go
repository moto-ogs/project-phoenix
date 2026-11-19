package traegerstaff

import (
	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/modules/workforce"
)

// SchoolPoolRouteContracts registers the school's view of the Träger's
// Springer pool (ADR 0270), with patterns relative to /api/staff-pool.
func SchoolPoolRouteContracts() []common.RouteContract {
	portals := []common.PortalScope{common.PortalTenant}
	week := []common.QueryParam{{Name: "week", Kind: common.QueryDate}}
	return []common.RouteContract{
		{Method: "GET", Pattern: "/", Portals: portals, Query: week, Response: workforce.PoolWeek{}},
		{Method: "POST", Pattern: "/blocks", Portals: portals, Request: blockRequest{}, Response: workforce.PoolBlock{}},
		{Method: "DELETE", Pattern: "/blocks/{id}", Portals: portals, NoData: true},
	}
}
