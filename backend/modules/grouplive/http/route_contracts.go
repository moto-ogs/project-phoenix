package grouplivehttp

import (
	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/modules/grouplive"
)

// RouteContracts registers the live view of one supervised group (#2056,
// ADR 0270), relative to /api/students. Without group_id the projection
// picks the caller's first group.
func RouteContracts() []common.RouteContract {
	return []common.RouteContract{
		{
			Method: "GET", Pattern: "/ogs-group-live", Portals: []common.PortalScope{common.PortalTenant},
			Query:    []common.QueryParam{{Name: "group_id", Kind: common.QueryID}},
			Response: grouplive.Projection{},
		},
	}
}
