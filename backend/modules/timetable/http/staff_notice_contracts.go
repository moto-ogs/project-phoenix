package timetablehttp

import "github.com/moto-ogs/project-phoenix/api/common"

// StaffNoticeRouteContracts registers the Tagesinformationen of the staff
// portal (#2352), with patterns relative to /api/staff-notices. Every route
// answers in the shared envelope.
func StaffNoticeRouteContracts() []common.RouteContract {
	portals := []common.PortalScope{common.PortalTenant}
	notice := noticeResponse{}
	return []common.RouteContract{
		{Method: "GET", Pattern: "/", Portals: portals, Response: []noticeResponse{}},
		{Method: "POST", Pattern: "/", Portals: portals, Request: noticeRequest{}, Response: notice},
		{Method: "GET", Pattern: "/today", Portals: portals, Response: []noticeResponse{}},
		{Method: "GET", Pattern: "/{noticeId}", Portals: portals, Response: notice},
		{Method: "PUT", Pattern: "/{noticeId}", Portals: portals, Request: noticeRequest{}, Response: notice},
		{Method: "DELETE", Pattern: "/{noticeId}", Portals: portals, NoData: true},
		{Method: "POST", Pattern: "/{noticeId}/acknowledge", Portals: portals, NoData: true},
		{Method: "GET", Pattern: "/{noticeId}/acknowledgements", Portals: portals, Response: []acknowledgerResponse{}},
	}
}
