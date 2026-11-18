package studentdeletionhttp

import "github.com/moto-ogs/project-phoenix/api/common"

// StudentRouteContracts registers the typed contract of the deletion
// previews and the purge (ADR 0270), with patterns relative to /api/students.
func StudentRouteContracts() []common.RouteContract {
	portals := []common.PortalScope{common.PortalTenant}
	return []common.RouteContract{
		{Method: "GET", Pattern: "/{id}/delete-impact", Portals: portals, Response: studentDeleteImpactResponse{}},
		{Method: "GET", Pattern: "/care-withdrawals/{completionId}/deletion-impact", Portals: portals, Response: studentDeleteImpactResponse{}},
		{Method: "DELETE", Pattern: "/{id}/purge", Portals: portals, NoData: true},
	}
}
