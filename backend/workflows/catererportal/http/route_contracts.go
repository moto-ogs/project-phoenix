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
	}
}
