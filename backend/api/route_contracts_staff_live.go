package api

import (
	classdayHTTP "github.com/moto-ogs/project-phoenix/modules/classday/http"
	presenceAPI "github.com/moto-ogs/project-phoenix/modules/studentpresence/inbound/presence"
	supervisionDashboardHTTP "github.com/moto-ogs/project-phoenix/modules/supervisiondashboard/http"
	openRoomMoveHTTP "github.com/moto-ogs/project-phoenix/workflows/openroommove/http"
)

// staffPortalLiveContractMounts are the live sessions, visits and the
// caller's own data of the staff portal (#2352).
func staffPortalLiveContractMounts() []contractMount {
	return []contractMount{
		{"/api/active", presenceAPI.RouteContracts()},
		{"/api/active", openRoomMoveHTTP.RouteContracts()},
		{"/api/active", supervisionDashboardHTTP.SchulhofRouteContracts()},
		{"/api/timetable", classdayHTTP.SlotListRouteContracts()},
	}
}
