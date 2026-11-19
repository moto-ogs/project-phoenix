package birthdays

import "github.com/moto-ogs/project-phoenix/api/common"

// RouteContracts registers the birthday overview and the personal opt-out
// (#2352), with patterns relative to /api/birthdays. The staff export
// answers a file and keeps its route file.
func RouteContracts() []common.RouteContract {
	portals := []common.PortalScope{common.PortalTenant}
	return []common.RouteContract{
		{Method: "GET", Pattern: "/", Portals: portals, Query: []common.QueryParam{{Name: "week_start", Kind: common.QueryDate}}, Response: overviewResponse{}},
		{Method: "GET", Pattern: "/opt-out", Portals: portals, Response: optOutResponse{}},
		{Method: "PUT", Pattern: "/opt-out", Portals: portals, Request: optOutRequest{}, Response: optOutResponse{}},
	}
}
