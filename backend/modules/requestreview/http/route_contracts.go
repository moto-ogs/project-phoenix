package requestreviewhttp

import (
	"slices"

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
	page := []common.QueryParam{
		text("search"),
		{Name: "student_id", Kind: common.QueryID},
		text("types"),
		text("cursor"),
		{Name: "limit", Kind: common.QueryInt},
	}
	history := append(slices.Clone(page),
		text("status"), common.QueryParam{Name: "from", Kind: common.QueryDate}, common.QueryParam{Name: "to", Kind: common.QueryDate})
	return []common.RouteContract{
		{Method: "GET", Pattern: "/change-requests", Portals: portals, Query: page, Response: requestreview.Page{}},
		{Method: "GET", Pattern: "/change-requests/history", Portals: portals, Query: history, Response: requestreview.HistoryPage{}},
		{Method: "GET", Pattern: "/change-requests/pending-count", Portals: portals, Response: ChangeRequestPendingCountResponse{}},
		{
			Method: "GET", Pattern: "/change-requests/access", Portals: portals,
			Query:    []common.QueryParam{{Name: "student_id", Kind: common.QueryID}},
			Response: changeRequestAccessResponse{},
		},
	}
}
