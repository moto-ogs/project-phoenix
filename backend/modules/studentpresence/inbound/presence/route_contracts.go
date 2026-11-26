package presence

import (
	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/modules/studentpresence"
)

// RouteContracts registers the typed contract of the live sessions, visits
// and supervisions the staff portal reads and moves children with (ADR
// 0270), with patterns relative to /api/active.
func RouteContracts() []common.RouteContract {
	portals := []common.PortalScope{common.PortalTenant}
	active := []common.QueryParam{{Name: "active", Kind: common.QueryBool}, {Name: "is_active", Kind: common.QueryBool}}
	visits := []common.QueryParam{{Name: "active", Kind: common.QueryBool}, {Name: "active_group_ids", Kind: common.QueryID, Repeated: true}}
	return []common.RouteContract{
		{Method: "GET", Pattern: "/groups/", Portals: portals, Query: active, Response: []ActiveGroupResponse{}},
		{Method: "GET", Pattern: "/groups/{id}/supervisors", Portals: portals, Response: []SupervisorResponse{}},
		{Method: "POST", Pattern: "/groups/{id}/claim", Portals: portals, Response: claimedSupervisionResponse{}},
		{Method: "GET", Pattern: "/visits/", Portals: portals, Query: visits, Response: []VisitResponse{}},
		{Method: "POST", Pattern: "/visits/transit/assign", Portals: portals, Request: assignTransitStudentsRequest{}, Response: studentpresence.TransitAssignResult{}},
		{Method: "POST", Pattern: "/visits/move-to-group", Portals: portals, Request: moveStudentsToActiveGroupRequest{}, Response: studentpresence.StudentMoveResult{}},
		{Method: "POST", Pattern: "/visits/check-in-to-group", Portals: portals, Request: checkInStudentsToSessionRequest{}, Response: studentpresence.StudentMoveResult{}},
		{Method: "GET", Pattern: "/supervisors/staff/{staffId}/active", Portals: portals, Response: []SupervisorResponse{}},
		// The ended supervision is read back; a failed read answers null.
		{Method: "POST", Pattern: "/supervisors/{id}/end", Portals: portals, Response: &SupervisorResponse{}},
		{Method: "POST", Pattern: "/tracking-indicators", Portals: portals, Request: TrackingIndicatorsRequest{}, Response: TrackingIndicatorsResponse{}},
		// The dashboard's figures left their reshaping route file in #7563.
		{Method: "GET", Pattern: "/analytics/dashboard", Portals: portals, Response: DashboardAnalyticsResponse{}},
	}
}
