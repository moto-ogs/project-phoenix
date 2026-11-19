package traegerportal

import "github.com/moto-ogs/project-phoenix/api/common"

var traegerPortal = []common.PortalScope{common.PortalTraeger}

// AccountRouteContracts registers the Träger-Büro's account management
// (ADR 0270), with patterns relative to /traeger/accounts. The exports
// answer files and keep their route files.
func AccountRouteContracts() []common.RouteContract {
	return []common.RouteContract{
		{Method: "GET", Pattern: "/", Portals: traegerPortal, Response: TraegerAccountsResponse{}},
		{Method: "GET", Pattern: "/history", Portals: traegerPortal, Query: []common.QueryParam{{Name: "before", Kind: common.QueryID}}, Response: TraegerHistoryResponse{}},
		{Method: "POST", Pattern: "/invitations", Portals: traegerPortal, Request: TraegerInviteRequest{}, Response: TraegerInvitationResponse{}},
		{Method: "DELETE", Pattern: "/invitations/{invitationId}", Portals: traegerPortal, NoData: true},
		{Method: "PUT", Pattern: "/{accountId}/roles", Portals: traegerPortal, Request: TraegerRolesRequest{}, Response: TraegerMemberResponse{}},
		{Method: "PUT", Pattern: "/{accountId}/name", Portals: traegerPortal, Request: TraegerNameRequest{}, Response: TraegerMemberResponse{}},
		{Method: "DELETE", Pattern: "/{accountId}", Portals: traegerPortal, NoData: true},
	}
}

// ProfileRouteContracts registers the signed-in member's own profile, with
// patterns relative to /traeger/profile.
func ProfileRouteContracts() []common.RouteContract {
	return []common.RouteContract{
		{Method: "GET", Pattern: "/", Portals: traegerPortal, Response: TraegerProfileResponse{}},
		{Method: "PUT", Pattern: "/name", Portals: traegerPortal, Request: TraegerNameRequest{}, Response: TraegerProfileResponse{}},
	}
}

// SchoolSessionRouteContracts registers the Absprung into a school, with
// patterns relative to /traeger/school-sessions. It answers a handoff token
// in the body; no cookie is set on the Träger host.
func SchoolSessionRouteContracts() []common.RouteContract {
	return []common.RouteContract{
		{Method: "POST", Pattern: "/", Portals: traegerPortal, Request: SchoolSessionRequest{}, Response: SchoolSessionResponse{}},
	}
}

// StepUpRouteContracts registers the code step in the running Träger session
// (#7068), with patterns relative to /traeger/auth. Starting it mails a code,
// so the proxy does not send it again after a session renewal.
func StepUpRouteContracts() []common.RouteContract {
	return []common.RouteContract{
		{
			Method: "POST", Pattern: "/mfa/step-up", Portals: traegerPortal, Response: StepUpStartResponse{},
			NoRetryAfterRenewal: "a renewed session would mail the code twice",
		},
	}
}

// invitationAcceptBodyBytes bounds the accept body: a name and two passwords.
const invitationAcceptBodyBytes = 4 << 10

// InvitationRouteContracts registers the mailed invitation into the
// Träger-Büro, which its link opens without a session (#2352), with patterns
// relative to /traeger/invitations.
func InvitationRouteContracts() []common.RouteContract {
	portals := []common.PortalScope{common.PortalPublic}
	return []common.RouteContract{
		{Method: "GET", Pattern: "/{token}", Portals: portals, Response: InvitationPreviewResponse{}},
		{Method: "POST", Pattern: "/{token}/accept", Portals: portals, Request: AcceptRequest{}, Response: AcceptResponse{}, MaxBodyBytes: invitationAcceptBodyBytes},
	}
}
