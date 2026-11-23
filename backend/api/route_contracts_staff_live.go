package api

import (
	classdayHTTP "github.com/moto-ogs/project-phoenix/modules/classday/http"
	meAPI "github.com/moto-ogs/project-phoenix/modules/identityaccess/inbound/me"
	peopleValues "github.com/moto-ogs/project-phoenix/modules/peopledirectory"
	presenceCompose "github.com/moto-ogs/project-phoenix/modules/studentpresence/compose"
	presenceAPI "github.com/moto-ogs/project-phoenix/modules/studentpresence/inbound/presence"
	supervisionDashboardHTTP "github.com/moto-ogs/project-phoenix/modules/supervisiondashboard/http"
	"github.com/moto-ogs/project-phoenix/roots/owners"
	openRoomMoveHTTP "github.com/moto-ogs/project-phoenix/workflows/openroommove/http"
)

// staffPortalLiveContractMounts are the live sessions, visits and the
// caller's own data of the staff portal (#2352).
func staffPortalLiveContractMounts() []contractMount {
	return []contractMount{
		{"/api/active", presenceAPI.RouteContracts()},
		{"/api/active", openRoomMoveHTTP.RouteContracts()},
		{"/api/active", supervisionDashboardHTTP.SchulhofRouteContracts()},
		{"/api/active", supervisionDashboardHTTP.DashboardRouteContracts()},
		{"/api/timetable", classdayHTTP.SlotListRouteContracts()},
		// The root loads the caller's rows; it names their types.
		{"/api/me", meAPI.RouteContracts(&peopleValues.Staff{}, []owners.CallerGroupRow{}, []presenceCompose.SessionRow{}, owners.CallerNavigationRow{})},
	}
}
