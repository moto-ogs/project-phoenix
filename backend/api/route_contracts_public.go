package api

import (
	careContractHTTP "github.com/moto-ogs/project-phoenix/modules/carecontract/http"
	enrollmentHTTP "github.com/moto-ogs/project-phoenix/modules/enrollment/http"
	accountHTTP "github.com/moto-ogs/project-phoenix/modules/identityaccess/inbound/account"
	traegerPortalHTTP "github.com/moto-ogs/project-phoenix/modules/traegerportal"
	catererPortalHTTP "github.com/moto-ogs/project-phoenix/workflows/catererportal/http"
)

// publicContractMounts lists the routes a request reaches without a session
// (#2352): the portal `public`, which every portal's proxy serves under its
// mount on a path that reads no session.
func publicContractMounts() []contractMount {
	return []contractMount{
		{"/api/enrollment", enrollmentHTTP.PublicRouteContracts()},
		{"/caterer", catererPortalHTTP.PublicRouteContracts()},
		{"/traeger/invitations", traegerPortalHTTP.InvitationRouteContracts()},
		{"/public/care-contract-signing", careContractHTTP.SigningRouteContracts()},
	}
}

// staffPortalInvitationContractMounts lists the staff portal's invitation
// routes the root mounts beside /api, at /auth/invitations (#2352).
func staffPortalInvitationContractMounts() []contractMount {
	return []contractMount{
		{"/auth/invitations", accountHTTP.InvitationRouteContracts()},
	}
}
