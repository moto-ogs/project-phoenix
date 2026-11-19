package timetablehttp

import "github.com/moto-ogs/project-phoenix/api/common"

// SchoolStaffNoticeRouteContracts registers the Tagesinformationen of moto
// schule (#2208), with patterns relative to /school/staff-notices.
func SchoolStaffNoticeRouteContracts() []common.RouteContract {
	portals := []common.PortalScope{common.PortalSchool}
	return []common.RouteContract{
		{Method: "GET", Pattern: "/today", Portals: portals, Response: []noticeResponse{}},
		{Method: "POST", Pattern: "/{noticeId}/acknowledge", Portals: portals, NoData: true},
	}
}

// WeekProtocolRouteContracts registers the weekly protocols of the groups
// (#4769), with patterns relative to /api/week-protocols. The PDF download
// keeps its route file.
func WeekProtocolRouteContracts() []common.RouteContract {
	portals := []common.PortalScope{common.PortalTenant}
	group := []common.QueryParam{{Name: "group_id", Kind: common.QueryID}}
	return []common.RouteContract{
		{Method: "GET", Pattern: "/", Portals: portals, Query: group, Response: []weekProtocolResponse{}},
		{Method: "GET", Pattern: "/{protocolId}", Portals: portals, Response: weekProtocolResponse{}},
		{Method: "PUT", Pattern: "/{protocolId}/notes", Portals: portals, Request: weekProtocolNotesRequest{}, Response: weekProtocolResponse{}},
		{Method: "POST", Pattern: "/{protocolId}/close", Portals: portals, Response: weekProtocolResponse{}},
	}
}
