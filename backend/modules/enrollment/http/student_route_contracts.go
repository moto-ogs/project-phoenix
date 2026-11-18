package enrollmenthttp

import "github.com/moto-ogs/project-phoenix/api/common"

// StudentRouteContracts registers the typed contract of the enrollment
// answers on a child's page (ADR 0270), with patterns relative to
// /api/students.
func StudentRouteContracts() []common.RouteContract {
	return []common.RouteContract{
		{
			Method: "GET", Pattern: "/{id}/enrollment-extra-fields", Portals: []common.PortalScope{common.PortalTenant},
			Response: []StudentEnrollmentExtraFieldGroup{},
		},
	}
}
