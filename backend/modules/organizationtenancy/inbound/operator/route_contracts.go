package operator

import "github.com/moto-ogs/project-phoenix/api/common"

// BillingRouteContracts registers the typed contract of the billing key day
// (ADR 0270), with patterns relative to the /operator/billing mount.
func BillingRouteContracts() []common.RouteContract {
	operator := []common.PortalScope{common.PortalOperator}
	return []common.RouteContract{
		{Method: "GET", Pattern: "/key-day", Portals: operator, Response: billingKeyDayResponse{}, Enums: overrideScopes},
		{Method: "PUT", Pattern: "/key-day", Portals: operator, Request: updateBillingKeyDayRequest{}, Response: billingKeyDayResponse{}, Enums: overrideScopes},
		{Method: "PUT", Pattern: "/key-day-overrides/organizations/{organizationId}", Portals: operator, Request: updateBillingKeyDayRequest{}, Response: billingKeyDayResponse{}, Enums: overrideScopes},
		{Method: "DELETE", Pattern: "/key-day-overrides/organizations/{organizationId}", Portals: operator, Response: billingKeyDayResponse{}, Enums: overrideScopes},
		{Method: "PUT", Pattern: "/key-day-overrides/schools/{schoolId}", Portals: operator, Request: updateBillingKeyDayRequest{}, Response: billingKeyDayResponse{}, Enums: overrideScopes},
		{Method: "DELETE", Pattern: "/key-day-overrides/schools/{schoolId}", Portals: operator, Response: billingKeyDayResponse{}, Enums: overrideScopes},
		billingKeyDateCountContract(),
		// The CSV of one month (YYYY-MM) or of every month (#2791, #2352).
		{Method: "GET", Pattern: "/key-date-counts/export", Portals: operator, Query: []common.QueryParam{{Name: "month", Kind: common.QueryString}}, File: true},
	}
}

// overrideScopes closes the scope of an own key day (#7301).
var overrideScopes = []common.EnumContract{{
	Name: "BillingKeyDayScope", Fields: []string{"billingKeyDayOverrideResponse.scope"},
	Values: []string{BillingKeyDayScopeOrganization, BillingKeyDayScopeSchool},
}}

// DeviceRouteContracts types the operator's device block routes
// (Gerätesperre, #2317), which answer without data, and the device history
// (#2321).
func DeviceRouteContracts() []common.RouteContract {
	operator := []common.PortalScope{common.PortalOperator}
	return []common.RouteContract{
		{Method: "POST", Pattern: "/{id}/block", Portals: operator, NoData: true},
		{Method: "POST", Pattern: "/{id}/unblock", Portals: operator, NoData: true},
		// The history of a device across its schools (#2321).
		{Method: "GET", Pattern: "/{id}/history", Portals: operator, Response: []deviceHistoryResponse{}},
	}
}

// SchoolDeviceSlotRouteContracts types the operator's change of a school's
// Geräteplätze (#2312). It answers without data; the school page reloads.
func SchoolDeviceSlotRouteContracts() []common.RouteContract {
	operator := []common.PortalScope{common.PortalOperator}
	return []common.RouteContract{
		{Method: "PUT", Pattern: "/{id}/device-slots", Portals: operator, Request: deviceSlotsRequest{}, NoData: true},
	}
}
