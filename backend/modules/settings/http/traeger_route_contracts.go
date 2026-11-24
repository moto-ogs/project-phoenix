package settingshttp

import "github.com/moto-ogs/project-phoenix/api/common"

// TraegerRouteContracts registers the Träger's settings schema (ADR 0270),
// with patterns relative to /traeger/settings. The schema type belongs to
// the Settings Platform's records, which this role may not import; the root
// names it in schema.
func TraegerRouteContracts(schema any) []common.RouteContract {
	const browserPath = "/api/traeger/settings/values/{key}"
	const routeFile = "invalidate the tenant lookup after inherited settings change"
	return []common.RouteContract{
		{Method: "GET", Pattern: "/schema", Portals: []common.PortalScope{common.PortalTraeger}, Response: schema},
		{Method: "PUT", Pattern: "/values/{key}", Portals: []common.PortalScope{common.PortalTraeger}, Request: setValueRequest{}, NoData: true, BrowserPath: browserPath, RouteFile: routeFile},
		{Method: "DELETE", Pattern: "/values/{key}", Portals: []common.PortalScope{common.PortalTraeger}, NoData: true, BrowserPath: browserPath, RouteFile: routeFile},
	}
}
