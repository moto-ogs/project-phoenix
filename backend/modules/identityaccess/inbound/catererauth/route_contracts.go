package catererauth

import (
	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess/inbound/portalauth"
)

// SecondFactorRouteContracts registers the caterer's reading and starting of
// its second factor and its remembered devices (#2352), relative to the
// /caterer mount. Confirming and switching off keep their route files: the
// confirmation installs a session, the switch-off maps the request body.
func SecondFactorRouteContracts() []common.RouteContract {
	portals := []common.PortalScope{common.PortalCaterer}
	return []common.RouteContract{
		{Method: "GET", Pattern: "/account/mfa", Portals: portals, Response: CatererMFAStatusResponse{}},
		{
			Method: "POST", Pattern: "/account/mfa/start", Portals: portals, Response: CatererMFAChallengeResponse{},
			NoRetryAfterRenewal: "a renewed session would mail the code twice",
		},
		{Method: "GET", Pattern: "/auth/mfa/trusted-devices", Portals: portals, Response: []common.TrustedDeviceDTO{}},
		{Method: "DELETE", Pattern: "/auth/mfa/trusted-devices/{" + portalauth.TrustedDeviceIDParam + "}", Portals: portals, NoData: true},
	}
}
