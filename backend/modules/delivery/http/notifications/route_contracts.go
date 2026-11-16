package notifications

import "github.com/moto-ogs/project-phoenix/api/common"

// FeedRouteContracts registers the typed contract of the notification feed
// of the staff portal (ADR 0270), with patterns relative to the
// /api/notifications mount. moto schule mounts the same routes; its
// registration waits for contract types shared between resources.
func FeedRouteContracts() []common.RouteContract {
	return []common.RouteContract{
		{
			Method: "GET", Pattern: "/feed/unread-count",
			Portals:  []common.PortalScope{common.PortalTenant},
			Response: feedCountResponse{},
		},
	}
}
