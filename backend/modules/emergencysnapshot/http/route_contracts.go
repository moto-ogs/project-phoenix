package http

import "github.com/moto-ogs/project-phoenix/api/common"

// RouteContracts registers the emergency snapshot of the staff portal
// (#2352), relative to /api/emergency. The export reads no body and answers a
// file.
func RouteContracts() []common.RouteContract {
	return []common.RouteContract{
		{Method: "POST", Pattern: "/snapshot/export", Portals: []common.PortalScope{common.PortalTenant}, File: true},
	}
}
