package requestreviewhttp

import (
	common "github.com/moto-ogs/project-phoenix/api/common"
	requestreview "github.com/moto-ogs/project-phoenix/modules/requestreview"
)

// ChangeRequestPendingCountResponse is the number behind the sidebar badge.
type ChangeRequestPendingCountResponse struct {
	PendingCount int `json:"pending_count"`
}

// StudentRouteContracts registers the typed contract of the unified parent
// request list (ADR 0270), with patterns relative to /api/students.
func StudentRouteContracts() []common.RouteContract {
	portals := []common.PortalScope{common.PortalTenant}
	text := func(name string) common.QueryParam { return common.QueryParam{Name: name, Kind: common.QueryString} }
	list := []common.QueryParam{
		{Name: "view", Kind: common.QueryString, Values: []string{"open", "history"}},
		text("search"),
		{Name: "student_id", Kind: common.QueryID},
		text("types"), text("status"),
		{Name: "from", Kind: common.QueryDate}, {Name: "to", Kind: common.QueryDate},
		text("cursor"),
		{Name: "limit", Kind: common.QueryInt},
	}
	return []common.RouteContract{
		{Method: "GET", Pattern: "/change-requests", Portals: portals, Query: list, Response: requestreview.Page{}},
		{Method: "GET", Pattern: "/change-requests/pending-count", Portals: portals, Response: ChangeRequestPendingCountResponse{}},
		{
			Method: "GET", Pattern: "/change-requests/access", Portals: portals,
			Query:    []common.QueryParam{{Name: "student_id", Kind: common.QueryID}},
			Response: changeRequestAccessResponse{},
		},
	}
}
