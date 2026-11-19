package openroommovehttp

import (
	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/modules/studentpresence"
)

// RouteContracts registers the typed contract of the moves into a released
// room (ADR 0270), with patterns relative to /api/active.
func RouteContracts() []common.RouteContract {
	portals := []common.PortalScope{common.PortalTenant}
	return []common.RouteContract{
		{Method: "POST", Pattern: "/visits/move-to-room", Portals: portals, Request: moveStudentsToOpenRoomRequest{}, Response: studentpresence.StudentMoveResult{}},
		{Method: "POST", Pattern: "/visits/check-in-to-room", Portals: portals, Request: checkInStudentsToOpenRoomRequest{}, Response: studentpresence.StudentMoveResult{}},
	}
}
