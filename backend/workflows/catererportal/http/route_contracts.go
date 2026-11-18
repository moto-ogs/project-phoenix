package catererportalhttp

import "github.com/moto-ogs/project-phoenix/api/common"

// RouteContracts registers the typed contract of the caterer's own routes
// (ADR 0270), with patterns relative to the /caterer mount.
func RouteContracts() []common.RouteContract {
	return []common.RouteContract{
		{
			Method: "GET", Pattern: "/schools",
			Portals:  []common.PortalScope{common.PortalCaterer},
			Response: SchoolsResponse{},
		},
		{
			Method: "GET", Pattern: "/schools/{schoolId}/orders",
			Portals:  []common.PortalScope{common.PortalCaterer},
			Query:    []common.QueryParam{{Name: "from", Kind: common.QueryDate}, {Name: "to", Kind: common.QueryDate}},
			Response: SchoolOrdersResponse{},
		},
		{
			Method: "POST", Pattern: "/schools/{schoolId}/orders/{orderId}/confirm",
			Portals: []common.PortalScope{common.PortalCaterer},
			NoData:  true,
		},
	}
}
