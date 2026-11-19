package settingshttp

import "github.com/moto-ogs/project-phoenix/api/common"

// TraegerRouteContracts registers the Träger's settings schema (ADR 0270),
// with patterns relative to /traeger/settings. The schema type belongs to
// the Settings Platform's records, which this role may not import; the root
// names it in schema.
func TraegerRouteContracts(schema any) []common.RouteContract {
	return []common.RouteContract{
		{Method: "GET", Pattern: "/schema", Portals: []common.PortalScope{common.PortalTraeger}, Response: schema},
		{Method: "PUT", Pattern: "/values/{key}", Portals: []common.PortalScope{common.PortalTraeger}, Request: setValueRequest{}, NoData: true},
		{Method: "DELETE", Pattern: "/values/{key}", Portals: []common.PortalScope{common.PortalTraeger}, NoData: true},
	}
}
