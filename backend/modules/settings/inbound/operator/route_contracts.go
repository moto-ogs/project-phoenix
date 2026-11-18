package operator

import "github.com/moto-ogs/project-phoenix/api/common"

// SchoolRouteContracts registers the operator's school settings routes (ADR
// 0270, #2352), relative to the /operator/schools/{id}/settings mount. The
// root names the schema type the platform renders. Setting and resetting a
// school value stay in their BFF route: it refreshes the tenant cache.
func SchoolRouteContracts(schema any) []common.RouteContract {
	operator := []common.PortalScope{common.PortalOperator}
	return []common.RouteContract{
		{Method: "GET", Pattern: "/schema", Portals: operator, Response: schema},
		{Method: "GET", Pattern: "/values/{key}/reveal", Portals: operator, Response: revealedSettingValue{}},
	}
}

// TraegerRouteContracts registers the operator's Träger settings routes,
// relative to the /operator/organizations/{id}/traeger-settings mount.
func TraegerRouteContracts(schema any) []common.RouteContract {
	operator := []common.PortalScope{common.PortalOperator}
	return []common.RouteContract{
		{Method: "GET", Pattern: "/schema", Portals: operator, Response: schema},
		{Method: "PUT", Pattern: "/values/{key}", Portals: operator, Request: setSchoolSettingRequest{}, NoData: true},
		{Method: "DELETE", Pattern: "/values/{key}", Portals: operator, NoData: true},
	}
}
