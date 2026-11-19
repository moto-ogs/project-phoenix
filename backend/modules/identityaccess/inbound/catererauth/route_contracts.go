package catererauth

import (
	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess/inbound/portalauth"
)

// SecondFactorRouteContracts registers the caterer's second factor, its
// remembered devices and its passkeys (#2352), relative to the /caterer
// mount. Confirming keeps its route file: it installs a session. The passkey
// sign-in mints a session and stays unregistered.
func SecondFactorRouteContracts() []common.RouteContract {
	portals := []common.PortalScope{common.PortalCaterer}
	return []common.RouteContract{
		{Method: "GET", Pattern: "/account/mfa", Portals: portals, Response: CatererMFAStatusResponse{}},
		{
			Method: "POST", Pattern: "/account/mfa/start", Portals: portals, Response: CatererMFAChallengeResponse{},
			NoRetryAfterRenewal: "a renewed session would mail the code twice",
		},
		{
			Method: "POST", Pattern: "/account/mfa/disable", Portals: portals, Request: portalauth.SwitchOffRequest{}, NoData: true,
			NoRetryAfterRenewal: "a renewed session would send the current password twice",
		},
		{Method: "GET", Pattern: "/auth/mfa/trusted-devices", Portals: portals, Response: []common.TrustedDeviceDTO{}},
		{Method: "DELETE", Pattern: "/auth/mfa/trusted-devices/{" + portalauth.TrustedDeviceIDParam + "}", Portals: portals, NoData: true},
		{Method: "GET", Pattern: "/auth/passkeys", Portals: portals, Response: []identityaccess.PasskeyCredentialSummary{}},
		{Method: "DELETE", Pattern: "/auth/passkeys/{passkeyId}", Portals: portals, NoData: true},
		{
			Method: "POST", Pattern: "/auth/passkeys/enrollment/challenge", Portals: portals, Response: identityaccess.PasskeyEnrollmentChallenge{},
			NoRetryAfterRenewal: "a renewed session would mail the code twice",
		},
		{
			Method: "POST", Pattern: "/auth/passkeys/register/options", Portals: portals, Request: common.PasskeyRegisterOptionsRequest{}, Response: identityaccess.PasskeyCeremonyOptions{},
			NoRetryAfterRenewal: "a renewed session would send the mailed code twice",
		},
		// A WebAuthn attestation of a one-time challenge: the renewal may
		// repeat it, as in the staff portal.
		{Method: "POST", Pattern: "/auth/passkeys/register/verify", Portals: portals, Request: common.PasskeyRegisterVerifyRequest{}, Response: identityaccess.PasskeyCredentialSummary{}},
	}
}
