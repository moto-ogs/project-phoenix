package api

import (
	"github.com/moto-ogs/project-phoenix/api/common"
	staffHTTP "github.com/moto-ogs/project-phoenix/modules/schoolmembership/http"
	absencetypesHTTP "github.com/moto-ogs/project-phoenix/modules/workforce/http/absencetypes"
	shifttypesHTTP "github.com/moto-ogs/project-phoenix/modules/workforce/http/shifttypes"
	staffshiftsHTTP "github.com/moto-ogs/project-phoenix/modules/workforce/http/staffshifts"
)

// The staff administration's route adapters may not import the contract
// types, so the root names their routes (ADR 0270), with patterns relative to
// each mount. A request whose fields read themselves (presence-tracked
// optional values) is not described: the proxy forwards the body as sent.

var tenantPortal = []common.PortalScope{common.PortalTenant}

func tenantRoute(method, pattern string, request, response any, query ...common.QueryParam) common.RouteContract {
	return common.RouteContract{Method: method, Pattern: pattern, Portals: tenantPortal, Query: query, Request: request, Response: response, NoData: response == nil}
}

// staffMembershipRouteContracts registers the School Membership half of
// /api/staff. The staff directory and the staff record left their reshaping
// route files in #7563; the list's filters are the ones the handler reads.
func staffMembershipRouteContracts() []common.RouteContract {
	listFilters := []common.QueryParam{
		{Name: "first_name", Kind: common.QueryString},
		{Name: "last_name", Kind: common.QueryString},
		{Name: "teachers_only", Kind: common.QueryBool},
		{Name: "role", Kind: common.QueryString},
	}
	return []common.RouteContract{
		staffRecordRoute(tenantRoute("GET", "/", nil, []staffHTTP.StaffRecordResponse{}, listFilters...)),
		tenantRoute("GET", "/former", nil, []staffHTTP.FormerStaffResponse{}, listFilters...),
		staffRecordRoute(tenantRoute("POST", "/", staffHTTP.StaffRequest{}, staffHTTP.StaffRecordResponse{})),
		staffRecordRoute(tenantRoute("GET", "/{id}", nil, staffHTTP.StaffRecordResponse{})),
		staffRecordRoute(tenantRoute("PUT", "/{id}", staffHTTP.StaffRequest{}, staffHTTP.StaffRecordResponse{})),
		tenantRoute("DELETE", "/{id}", nil, nil),
		staffRecordRoute(tenantRoute("POST", "/externals", staffHTTP.ExternalStaffRequest{}, staffHTTP.ExternalStaffResponse{})),
		staffRecordRoute(tenantRoute("POST", "/externals/{id}/invitation", staffHTTP.ExternalInvitationRequest{}, staffHTTP.ExternalStaffResponse{})),
		tenantRoute("GET", "/financial-profile/{id}", nil, staffHTTP.MinimalStaffProfileResponse{}),
		tenantRoute("GET", "/documents-profile/{id}", nil, staffHTTP.MinimalStaffProfileResponse{}),
		tenantRoute("GET", "/{id}/school-classes", nil, staffHTTP.SchoolClassesResponse{}),
		tenantRoute("PUT", "/{id}/school-classes", staffHTTP.SchoolClassesRequest{}, staffHTTP.SchoolClassesResponse{}),
		tenantRoute("PUT", "/{id}/planned-exit", staffHTTP.PlannedExitRequest{}, staffHTTP.PlannedExitResponse{}),
		tenantRoute("DELETE", "/{id}/planned-exit", nil, nil),
	}
}

// staffRecordRoute names the closed value sets of a staff record: the
// account state of an external caregiver (#4573) and the grammatical form of
// the position.
func staffRecordRoute(route common.RouteContract) common.RouteContract {
	route.Enums = []common.EnumContract{
		{Name: "ExternalAccountStatus", Fields: []string{"StaffResponse.external_account_status"}, Values: []string{"account", "invitation_pending", "none"}},
		{Name: "RoleForm", Fields: []string{"StaffRecordResponse.role_form"}, Values: []string{"feminine", "masculine"}},
	}
	return route
}

// absenceTypeRouteContracts registers /api/absence-types.
func absenceTypeRouteContracts() []common.RouteContract {
	return []common.RouteContract{
		tenantRoute("GET", "/", nil, []absencetypesHTTP.AbsenceTypeResponse{}),
		tenantRoute("POST", "/", absencetypesHTTP.CreateAbsenceTypeRequest{}, absencetypesHTTP.AbsenceTypeResponse{}),
		tenantRoute("PUT", "/{id}", absencetypesHTTP.UpdateAbsenceTypeRequest{}, absencetypesHTTP.AbsenceTypeResponse{}),
		tenantRoute("GET", "/{id}/allowances/{staffId}/preview", nil, absencetypesHTTP.AllowancePreviewResponse{},
			common.QueryParam{Name: "date_start", Kind: common.QueryDate}, common.QueryParam{Name: "date_end", Kind: common.QueryDate},
			common.QueryParam{Name: "half_day", Kind: common.QueryBool}),
	}
}

// shiftTypeRouteContracts registers /api/shift-types.
func shiftTypeRouteContracts() []common.RouteContract {
	return []common.RouteContract{
		tenantRoute("GET", "/", nil, []shifttypesHTTP.ShiftTypeResponse{},
			common.QueryParam{Name: "include_archived", Kind: common.QueryBool}, common.QueryParam{Name: "with_usage", Kind: common.QueryBool}),
		tenantRoute("POST", "/", shifttypesHTTP.ShiftTypeRequest{}, shifttypesHTTP.ShiftTypeResponse{}),
		tenantRoute("POST", "/defaults", nil, []shifttypesHTTP.ShiftTypeResponse{}),
	}
}

// staffShiftRouteContracts registers /api/staff-shifts.
func staffShiftRouteContracts() []common.RouteContract {
	week := []common.QueryParam{{Name: "from", Kind: common.QueryDate}, {Name: "to", Kind: common.QueryDate}}
	return []common.RouteContract{
		tenantRoute("GET", "/", nil, []staffshiftsHTTP.ShiftResponse{}, append(week, common.QueryParam{Name: "staff_id", Kind: common.QueryID})...),
		tenantRoute("GET", "/overview", nil, staffshiftsHTTP.OverviewResponse{}, week...),
		tenantRoute("POST", "/", nil, staffshiftsHTTP.ShiftResponse{}),
		tenantRoute("PUT", "/{id}", nil, staffshiftsHTTP.ShiftResponse{}),
		tenantRoute("DELETE", "/{id}", nil, staffshiftsHTTP.ShiftDeletedResponse{}),
		tenantRoute("PUT", "/{id}/move", nil, staffshiftsHTTP.ShiftResponse{}),
		tenantRoute("PUT", "/{id}/cancellation", nil, staffshiftsHTTP.CancellationResponse{}),
		tenantRoute("POST", "/series", nil, staffshiftsHTTP.SeriesResponse{}),
		tenantRoute("GET", "/series/{id}", nil, staffshiftsHTTP.SeriesDetailResponse{}),
		tenantRoute("PUT", "/series/{id}/split", nil, staffshiftsHTTP.SeriesResponse{}),
		tenantRoute("DELETE", "/series/{id}", nil, staffshiftsHTTP.SeriesResponse{}, common.QueryParam{Name: "from", Kind: common.QueryDate}),
	}
}
