package httpadapter

import apiCommon "github.com/moto-ogs/project-phoenix/api/common"

// RouteContracts registers the typed contract of the activity routes the
// staff portal reaches through its proxy (ADR 0270, #7563), with patterns
// relative to /api/activities. The enrolled-student list and the batch
// enrollment stay with their own route file until a Go view replaces the
// calls it bundles.
func RouteContracts() []apiCommon.RouteContract {
	portals := []apiCommon.PortalScope{apiCommon.PortalTenant}
	categoryFlags := []apiCommon.QueryParam{
		{Name: "include_system", Kind: apiCommon.QueryBool},
		{Name: "include_archived", Kind: apiCommon.QueryBool},
		{Name: "with_usage", Kind: apiCommon.QueryBool},
	}
	return []apiCommon.RouteContract{
		{Method: "GET", Pattern: "/", Portals: portals, Query: []apiCommon.QueryParam{
			{Name: "category_id", Kind: apiCommon.QueryID},
			{Name: "include_system", Kind: apiCommon.QueryBool},
		}, Response: []ActivityResponse{}},
		{Method: "POST", Pattern: "/", Portals: portals, Request: ActivityRequest{}, Response: ActivityResponse{}},
		{Method: "GET", Pattern: "/{id}", Portals: portals, Response: ActivityResponse{}},
		{Method: "PUT", Pattern: "/{id}", Portals: portals, Request: ActivityRequest{}, Response: ActivityResponse{}},
		{Method: "DELETE", Pattern: "/{id}", Portals: portals, NoData: true},
		{Method: "POST", Pattern: "/quick-create", Portals: portals, Request: QuickActivityRequest{}, Response: QuickActivityResponse{}},
		{Method: "GET", Pattern: "/categories", Portals: portals, Query: categoryFlags, Response: []ActivityCategoryResponse{}},
		{Method: "POST", Pattern: "/categories", Portals: portals, Request: ActivityCategoryRequest{}, Response: ActivityCategoryResponse{}},
		{Method: "PUT", Pattern: "/categories/{categoryId}", Portals: portals, Request: ActivityCategoryRequest{}, Response: ActivityCategoryResponse{}},
		{Method: "DELETE", Pattern: "/categories/{categoryId}", Portals: portals, Response: ActivityCategoryResponse{}},
		{Method: "POST", Pattern: "/categories/{categoryId}/restore", Portals: portals, Response: ActivityCategoryResponse{}},
		{Method: "GET", Pattern: "/supervisors/available", Portals: portals, Query: []apiCommon.QueryParam{
			{Name: "specialization", Kind: apiCommon.QueryString},
		}, Response: []ActivitySupervisorResponse{}},
		{Method: "DELETE", Pattern: "/{id}/supervisors/{supervisorId}", Portals: portals, Query: []apiCommon.QueryParam{
			{Name: "replacement_staff_id", Kind: apiCommon.QueryID},
		}, NoData: true},
		{Method: "DELETE", Pattern: "/{id}/students/{studentId}", Portals: portals, NoData: true},
		{Method: "GET", Pattern: "/{id}/schedules", Portals: portals, Deprecated: true, Response: []ActivityScheduleResponse{}},
		{Method: "GET", Pattern: routeScheduleByID, Portals: portals, Deprecated: true, Response: ActivityScheduleResponse{}},
	}
}

// ScheduleRouteContracts registers the timeframe list under /api/schedules.
// No client calls it; it is deprecated for one release before it leaves
// (ADR 0270, #2352).
func ScheduleRouteContracts() []apiCommon.RouteContract {
	return []apiCommon.RouteContract{
		{Method: "GET", Pattern: "/timeframes/", Portals: []apiCommon.PortalScope{apiCommon.PortalTenant}, Query: []apiCommon.QueryParam{
			{Name: "description", Kind: apiCommon.QueryString},
			{Name: "page", Kind: apiCommon.QueryInt},
			{Name: "page_size", Kind: apiCommon.QueryInt},
		}, Paginated: true, Response: []TimeframeResponse{}, Deprecated: true},
	}
}
