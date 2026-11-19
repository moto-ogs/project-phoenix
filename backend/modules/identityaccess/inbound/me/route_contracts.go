package me

import "github.com/moto-ogs/project-phoenix/api/common"

// RouteContracts registers the typed contract of the caller's own profile,
// staff record, groups and navigation context (ADR 0270), with patterns
// relative to /api/me. The rows the root loads (Rows) render the staff record,
// the educational groups, the room sessions and the navigation context, so the
// root names their types.
func RouteContracts(staff, groups, sessions, navigation any) []common.RouteContract {
	portals := []common.PortalScope{common.PortalTenant}
	return []common.RouteContract{
		{Method: "GET", Pattern: "/profile", Portals: portals, Response: ProfileResponse{}},
		{Method: "PUT", Pattern: "/profile", Portals: portals, Request: ProfileUpdateRequest{}, Response: ProfileResponse{}},
		{Method: "GET", Pattern: "/staff", Portals: portals, Response: staff},
		{Method: "GET", Pattern: "/groups/", Portals: portals, Response: groups},
		{Method: "GET", Pattern: "/groups/supervised", Portals: portals, Response: sessions},
		{Method: "GET", Pattern: "/navigation", Portals: portals, Response: navigation},
	}
}
