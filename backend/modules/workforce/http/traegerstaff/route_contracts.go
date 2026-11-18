package traegerstaff

import "github.com/moto-ogs/project-phoenix/api/common"

// RecordRouteContracts registers the typed contract of the staff records
// (ADR 0270), with patterns relative to /traeger/staff-records. Only the
// person correction (#7379) is registered so far; the older routes keep
// their route files until they move.
func RecordRouteContracts() []common.RouteContract {
	return []common.RouteContract{
		{Method: "PUT", Pattern: "/{id}/person", Portals: []common.PortalScope{common.PortalTraeger}, Request: PersonRequest{}, NoData: true},
	}
}
