package schoolportal

import (
	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess/inbound/portalauth"
)

// AuthRouteContracts registers the teacher's own remembered devices (#2352),
// with patterns relative to /school/auth.
func AuthRouteContracts() []common.RouteContract {
	return portalauth.TrustedDeviceRouteContracts(common.PortalSchool)
}
