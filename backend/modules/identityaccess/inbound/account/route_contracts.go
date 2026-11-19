package account

import "github.com/moto-ogs/project-phoenix/api/common"

// InvitationRouteContracts registers the staff portal's invitation routes
// that left their pass-through route files (#2352), relative to
// /auth/invitations. Listing and creating invitations followed in #7563; the
// list never carries an invitation's token.
func InvitationRouteContracts() []common.RouteContract {
	portals := []common.PortalScope{common.PortalTenant}
	return []common.RouteContract{
		{Method: "GET", Pattern: "/", Portals: portals, Response: []SchoolInvitationResponse{}},
		{Method: "POST", Pattern: "/", Portals: portals, Request: CreateSchoolInvitationRequest{}, Response: SchoolInvitationResponse{}},
		{Method: "POST", Pattern: "/former-employment", Portals: portals, Request: FormerEmploymentRequest{}, Response: FormerEmploymentResponse{}},
		{Method: "POST", Pattern: "/{id}/resend", Portals: portals, Response: InvitationResendResponse{}},
		{Method: "DELETE", Pattern: "/{id}/", Portals: portals, NoData: true},
	}
}
