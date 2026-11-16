package staffmessaging

import "github.com/moto-ogs/project-phoenix/api/common"

// SchoolRouteContracts registers the typed contract of the colleague chat
// in moto schule (ADR 0270), with patterns relative to the
// /school/staff-messages mount.
func SchoolRouteContracts() []common.RouteContract {
	return []common.RouteContract{
		{
			Method: "GET", Pattern: "/unread-count",
			Portals:  []common.PortalScope{common.PortalSchool},
			Response: unreadCountResponse{},
		},
	}
}
