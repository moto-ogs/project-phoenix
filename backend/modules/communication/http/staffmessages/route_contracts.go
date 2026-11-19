package staffmessaging

import "github.com/moto-ogs/project-phoenix/api/common"

// RouteContracts registers the typed contract of the colleague chat a portal
// mounts (ADR 0270), with patterns relative to its /staff-messages mount.
// The staff portal and moto schule share the conversations; only the staff
// portal starts and manages group chats.
func RouteContracts(portal common.PortalScope) []common.RouteContract {
	portals := []common.PortalScope{portal}
	onlyUnread := []common.QueryParam{{Name: "only_unread", Kind: common.QueryBool}}
	routes := []common.RouteContract{
		{Method: "GET", Pattern: "/", Portals: portals, Query: onlyUnread, Response: []InboxThreadResponse{}},
		{Method: "GET", Pattern: "/unread-count", Portals: portals, Response: unreadCountResponse{}},
		{Method: "GET", Pattern: "/recipients", Portals: portals, Response: []RecipientResponse{}},
		{Method: "POST", Pattern: "/threads/open", Portals: portals, Request: openThreadRequest{}, Response: ThreadDetailResponse{}},
		{Method: "GET", Pattern: "/threads/{threadID}", Portals: portals, Response: ThreadDetailResponse{}},
		{Method: "POST", Pattern: "/threads/{threadID}", Portals: portals, Request: postMessageRequest{}, Response: MessageResponse{}},
		{Method: "POST", Pattern: "/threads/{threadID}/leave", Portals: portals, NoData: true},
	}
	if portal != common.PortalTenant {
		return routes
	}
	// Removing a member answers the thread, or null when the caller removed
	// themselves.
	return append(routes,
		common.RouteContract{Method: "POST", Pattern: "/groups", Portals: portals, Request: groupRequest{}, Response: ThreadDetailResponse{}},
		common.RouteContract{Method: "PUT", Pattern: "/threads/{threadID}/name", Portals: portals, Request: renameGroupRequest{}, Response: ThreadDetailResponse{}},
		common.RouteContract{Method: "POST", Pattern: "/threads/{threadID}/members", Portals: portals, Request: groupRequest{}, Response: ThreadDetailResponse{}},
		common.RouteContract{Method: "DELETE", Pattern: "/threads/{threadID}/members/{accountID}", Portals: portals, Response: &ThreadDetailResponse{}},
	)
}
