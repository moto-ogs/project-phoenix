package messaging

import "github.com/moto-ogs/project-phoenix/api/common"

// RouteContracts registers the typed contract of the parent messages of the
// staff portal (ADR 0270), with patterns relative to /api/messages: the
// group threads (#4784), the mails of OGS messages (#7058) and the reads of
// who a new conversation reaches.
func RouteContracts() []common.RouteContract {
	portals := []common.PortalScope{common.PortalTenant}
	audience := []common.QueryParam{{Name: "audience", Kind: common.QueryString}}
	target := []common.QueryParam{{Name: "target_type", Kind: common.QueryString}, {Name: "target_id", Kind: common.QueryString}}
	return []common.RouteContract{
		{Method: "GET", Pattern: "/students/{studentId}/guardians", Portals: portals, Query: audience, Response: []GuardianResponse{}},
		{Method: "GET", Pattern: "/reachable-students", Portals: portals, Response: ReachableStudentsResponse{}},
		{Method: "GET", Pattern: "/threads/{threadId}/mails", Portals: portals, Response: ThreadMailsResponse{}},
		{Method: "GET", Pattern: "/group-threads", Portals: portals, Response: []GroupThreadSummaryResponse{}},
		{Method: "GET", Pattern: "/group-threads/audience", Portals: portals, Query: target, Response: []GroupChildResponse{}},
		{Method: "POST", Pattern: "/group-threads", Portals: portals, Request: CreateGroupThreadRequest{}, Response: GroupThreadDetailResponse{}},
		{Method: "GET", Pattern: "/group-threads/{groupThreadId}", Portals: portals, Response: GroupThreadDetailResponse{}},
		{Method: "POST", Pattern: "/group-threads/{groupThreadId}/messages", Portals: portals, Request: GroupMessageRequest{}, Response: GroupThreadDetailResponse{}},
		{Method: "POST", Pattern: "/group-threads/{groupThreadId}/close", Portals: portals, Response: GroupThreadDetailResponse{}},
		{Method: "GET", Pattern: "/group-threads/{groupThreadId}/mails", Portals: portals, Response: GroupThreadMailsResponse{}},
	}
}
