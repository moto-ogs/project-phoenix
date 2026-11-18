package traegerstaff

import (
	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/modules/workforce"
)

// RecordRouteContracts registers the typed contract of the staff records
// (ADR 0270), with patterns relative to /traeger/staff-records. Only the
// person correction (#7379) is registered so far; the older routes keep
// their route files until they move.
func RecordRouteContracts() []common.RouteContract {
	return []common.RouteContract{
		{Method: "PUT", Pattern: "/{id}/person", Portals: []common.PortalScope{common.PortalTraeger}, Request: PersonRequest{}, NoData: true},
	}
}

// ReleaseRouteContracts registers the operator's release „Personal beim
// Träger“ (ADR 0270, #2352), relative to the
// /operator/organizations/{id}/staff-release mount.
func ReleaseRouteContracts() []common.RouteContract {
	operator := []common.PortalScope{common.PortalOperator}
	return []common.RouteContract{
		{Method: "GET", Pattern: "", Portals: operator, Response: workforce.TraegerStaffReleaseState{}},
		{Method: "POST", Pattern: "", Portals: operator, Request: grantRequest{}, Response: workforce.TraegerStaffRelease{}},
		{Method: "DELETE", Pattern: "", Portals: operator, Response: withdrawnReleaseResponse{}},
	}
}
