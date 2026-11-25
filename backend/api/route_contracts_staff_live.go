package api

import (
	classdayHTTP "github.com/moto-ogs/project-phoenix/modules/classday/http"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess"
	meAPI "github.com/moto-ogs/project-phoenix/modules/identityaccess/inbound/me"
	peopleValues "github.com/moto-ogs/project-phoenix/modules/peopledirectory"
	presenceCompose "github.com/moto-ogs/project-phoenix/modules/studentpresence/compose"
	presenceAPI "github.com/moto-ogs/project-phoenix/modules/studentpresence/inbound/presence"
	supervisionDashboardHTTP "github.com/moto-ogs/project-phoenix/modules/supervisiondashboard/http"
	"github.com/moto-ogs/project-phoenix/roots/owners"
	openRoomMoveHTTP "github.com/moto-ogs/project-phoenix/workflows/openroommove/http"
)

// tenantLiveContractMounts are the live sessions, visits and the
// caller's own data of the staff portal.
func tenantLiveContractMounts() []contractMount {
	return []contractMount{
		{"/api/active", presenceAPI.RouteContracts()},
		{"/api/active", openRoomMoveHTTP.RouteContracts()},
		{"/api/active", supervisionDashboardHTTP.SchulhofRouteContracts()},
		{"/api/active", supervisionDashboardHTTP.DashboardRouteContracts()},
		{"/api/active", supervisionDashboardHTTP.RouteContracts()},
		{"/api/timetable", classdayHTTP.SlotListRouteContracts()},
		// The root loads the caller's rows; it names their types.
		{"/api/me", meAPI.RouteContracts(&peopleValues.Staff{}, []owners.CallerGroupRow{}, []presenceCompose.SessionRow{}, identityaccess.NavigationResponse[*peopleValues.Staff]{})},
	}
}
