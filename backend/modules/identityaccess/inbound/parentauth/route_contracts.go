package parentauth

import (
	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess/inbound/portalauth"
)

// SecondFactorRouteContracts registers the parent's reading and starting of
// its second factor and its remembered devices (#2352), relative to the
// /parent mount, and switching it off with the current password. Confirming
// keeps its route file: the confirmation installs a session.
func SecondFactorRouteContracts() []common.RouteContract {
	portals := []common.PortalScope{common.PortalParent}
	return []common.RouteContract{
		{Method: "GET", Pattern: "/me/mfa", Portals: portals, Response: ParentMFAStatusResponse{}},
		{
			Method: "POST", Pattern: "/me/mfa/start", Portals: portals, Response: ParentMFAChallengeResponse{},
			NoRetryAfterRenewal: "a renewed session would mail the code twice",
		},
		{
			Method: "POST", Pattern: "/me/mfa/disable", Portals: portals, Request: portalauth.SwitchOffRequest{}, NoData: true,
			NoRetryAfterRenewal: "a renewed session would send the current password twice",
		},
		{Method: "GET", Pattern: "/me/mfa/trusted-devices", Portals: portals, Response: []common.TrustedDeviceDTO{}},
		{Method: "DELETE", Pattern: "/me/mfa/trusted-devices/{" + portalauth.TrustedDeviceIDParam + "}", Portals: portals, NoData: true},
	}
}

// SessionRouteContracts registers the parent's sign-in, its second factor
// and the confirmation that switches it on (#7808), relative to /parent.
// Each answer carries tokens, so only the portal's route file reads it and
// no proxy allowlist names the route.
func SessionRouteContracts() []common.RouteContract {
	portals := []common.PortalScope{common.PortalParent}
	step := func(pattern string, request, response any, plain bool) common.RouteContract {
		return common.RouteContract{
			Method: "POST", Pattern: pattern, Portals: portals, RouteFile: common.RouteFileSession,
			Request: request, Response: response, Plain: plain,
		}
	}
	return []common.RouteContract{
		step("/auth/login", parentLoginRequest{}, portalauth.LoginResponse{}, false),
		step("/auth/mfa/verify", common.MFAVerifyRequest{}, portalauth.TokenResponse{}, true),
		step("/auth/mfa/resend", common.MFAResendRequest{}, common.MFAResendResponse{}, true),
		step("/me/mfa/confirm", common.MFAVerifyRequest{}, portalauth.TokenResponse{}, true),
	}
}
