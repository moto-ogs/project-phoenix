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

// SessionRouteContracts registers the teacher's sign-in and second factor
// (#7808), relative to /school/auth. Each answer carries tokens, so only the
// portal's route file reads it and no proxy allowlist names the route.
func SessionRouteContracts() []common.RouteContract {
	school := []common.PortalScope{common.PortalSchool}
	step := func(pattern string, request, response any) common.RouteContract {
		return common.RouteContract{
			Method: "POST", Pattern: pattern, Portals: school, RouteFile: common.RouteFileSession,
			Request: request, Response: response, Plain: true,
		}
	}
	return []common.RouteContract{
		step("/login", SchoolLoginRequest{}, portalauth.LoginResponse{}),
		step("/mfa/verify", common.MFAVerifyRequest{}, portalauth.TokenResponse{}),
		step("/mfa/resend", common.MFAResendRequest{}, common.MFAResendResponse{}),
		step("/mfa/enroll/start", nil, portalauth.EnrollStartResponse{}),
		step("/mfa/enroll/confirm", common.MFAVerifyRequest{}, portalauth.TokenResponse{}),
	}
}
