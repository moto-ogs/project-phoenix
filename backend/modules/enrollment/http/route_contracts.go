package enrollmenthttp

import "github.com/moto-ogs/project-phoenix/api/common"

// PhaseRouteContracts registers the typed contract of the enrollment phase
// routes (ADR 0270), with patterns relative to /api/enrollment/phases.
func PhaseRouteContracts() []common.RouteContract {
	portals := []common.PortalScope{common.PortalTenant}
	return []common.RouteContract{
		{Method: "GET", Pattern: "/expiry-warnings", Portals: portals, Response: []PhaseExpiryWarningResponse{}},
	}
}
