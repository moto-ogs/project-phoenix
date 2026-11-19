package parentauth

import (
	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess/inbound/portalauth"
)

// SecondFactorRouteContracts registers the parent's reading and starting of
// its second factor and its remembered devices (#2352), relative to the
// /parent mount. Confirming and switching off keep their route files: the
// confirmation installs a session, the switch-off maps the request body.
func SecondFactorRouteContracts() []common.RouteContract {
	portals := []common.PortalScope{common.PortalParent}
	return []common.RouteContract{
		{Method: "GET", Pattern: "/me/mfa", Portals: portals, Response: ParentMFAStatusResponse{}},
		{
			Method: "POST", Pattern: "/me/mfa/start", Portals: portals, Response: ParentMFAChallengeResponse{},
			NoRetryAfterRenewal: "a renewed session would mail the code twice",
		},
		{Method: "GET", Pattern: "/me/mfa/trusted-devices", Portals: portals, Response: []common.TrustedDeviceDTO{}},
		{Method: "DELETE", Pattern: "/me/mfa/trusted-devices/{" + portalauth.TrustedDeviceIDParam + "}", Portals: portals, NoData: true},
	}
}
