package api

import (
	"github.com/moto-ogs/project-phoenix/api/common"
	staffHTTP "github.com/moto-ogs/project-phoenix/modules/schoolmembership/http"
	"github.com/moto-ogs/project-phoenix/modules/workforce"
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
		// The avatar image; ?v names the stored file, and only a current
		// version stays in the browser's private cache for a day (#2352).
		{
			Method: "GET", Pattern: "/{id}/avatar", Portals: []common.PortalScope{common.PortalTenant},
			Query: []common.QueryParam{{Name: "v", Kind: common.QueryString}}, File: true, PrivateCache: true,
		},
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
		// The yearly Kontingent of one staff member left its reshaping route
		// file in #7563.
		tenantRoute("GET", "/{id}/allowances/{staffId}", nil, absencetypesHTTP.AllowanceSummaryResponse{},
			common.QueryParam{Name: "year", Kind: common.QueryInt}),
		tenantRoute("PUT", "/{id}/allowances/{staffId}", absencetypesHTTP.SetAllowanceRequest{}, absencetypesHTTP.AllowanceSummaryResponse{}),
	}
}

// shiftTypeRouteContracts registers /api/shift-types.
func shiftTypeRouteContracts() []common.RouteContract {
	return []common.RouteContract{
		tenantRoute("GET", "/", nil, []shifttypesHTTP.ShiftTypeResponse{},
			common.QueryParam{Name: "include_archived", Kind: common.QueryBool}, common.QueryParam{Name: "with_usage", Kind: common.QueryBool}),
		tenantRoute("POST", "/", shifttypesHTTP.ShiftTypeRequest{}, shifttypesHTTP.ShiftTypeResponse{}),
		tenantRoute("POST", "/defaults", nil, []shifttypesHTTP.ShiftTypeResponse{}),
		// Update and removal left their route file in #7563. A removal names
		// whether the type is gone or archived for the shifts that carry it.
		tenantRoute("PUT", "/{id}", shifttypesHTTP.ShiftTypeRequest{}, shifttypesHTTP.ShiftTypeResponse{}),
		shiftTypeRemovalRoute(tenantRoute("DELETE", "/{id}", nil, shifttypesHTTP.ShiftTypeDeleteResponse{})),
	}
}

// shiftTypeRemovalRoute names the two outcomes of removing a shift type.
func shiftTypeRemovalRoute(route common.RouteContract) common.RouteContract {
	route.Enums = []common.EnumContract{
		{Name: "ShiftTypeRemovalOutcome", Fields: []string{"ShiftTypeDeleteResponse.outcome"}, Values: []string{"archived", "deleted"}},
	}
	return route
}

// breakDayShiftsRoute names the two reasons a series leaves a day out (#8205).
func breakDayShiftsRoute(route common.RouteContract) common.RouteContract {
	route.Enums = []common.EnumContract{
		{Name: "SeriesBreakDayKind", Fields: []string{"SeriesBreakDayShift.break"}, Values: []string{workforce.BreakDayClosingDay, workforce.BreakDayHolidayPeriod}},
	}
	return route
}

// staffShiftRouteContracts registers /api/staff-shifts.
func staffShiftRouteContracts() []common.RouteContract {
	week := []common.QueryParam{{Name: "from", Kind: common.QueryDate}, {Name: "to", Kind: common.QueryDate}}
	return []common.RouteContract{
		tenantRoute("GET", "/", nil, []staffshiftsHTTP.ShiftResponse{}, append(week, common.QueryParam{Name: "staff_id", Kind: common.QueryID})...),
		tenantRoute("GET", "/overview", nil, staffshiftsHTTP.OverviewResponse{}, week...),
		breakDayShiftsRoute(tenantRoute("GET", "/break-day-shifts", nil, []workforce.SeriesBreakDayShift{})),
		tenantRoute("POST", "/", staffshiftsHTTP.ShiftRequest{}, staffshiftsHTTP.ShiftResponse{}),
		tenantRoute("PUT", "/{id}", staffshiftsHTTP.ShiftRequest{}, staffshiftsHTTP.ShiftResponse{}),
		tenantRoute("DELETE", "/{id}", nil, staffshiftsHTTP.ShiftDeletedResponse{}),
		tenantRoute("PUT", "/{id}/move", staffshiftsHTTP.MoveShiftRequest{}, staffshiftsHTTP.ShiftResponse{}),
		tenantRoute("PUT", "/{id}/cancellation", staffshiftsHTTP.CancellationRequest{}, staffshiftsHTTP.CancellationResponse{}),
		tenantRoute("POST", "/series", staffshiftsHTTP.SeriesRequest{}, staffshiftsHTTP.SeriesResponse{}),
		tenantRoute("GET", "/series/{id}", nil, staffshiftsHTTP.SeriesDetailResponse{}),
		tenantRoute("PUT", "/series/{id}/split", staffshiftsHTTP.SeriesSplitRequest{}, staffshiftsHTTP.SeriesResponse{}),
		tenantRoute("DELETE", "/series/{id}", nil, staffshiftsHTTP.SeriesResponse{}, common.QueryParam{Name: "from", Kind: common.QueryDate}),
		{Method: "POST", Pattern: "/export", Portals: []common.PortalScope{common.PortalTenant}, Request: staffshiftsHTTP.PlanExportRequest{}, File: true},
	}
}
