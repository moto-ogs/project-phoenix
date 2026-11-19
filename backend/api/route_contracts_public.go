package api

import (
	careContractHTTP "github.com/moto-ogs/project-phoenix/modules/carecontract/http"
	enrollmentHTTP "github.com/moto-ogs/project-phoenix/modules/enrollment/http"
	accountHTTP "github.com/moto-ogs/project-phoenix/modules/identityaccess/inbound/account"
	catererAuthHTTP "github.com/moto-ogs/project-phoenix/modules/identityaccess/inbound/catererauth"
	parentAuthHTTP "github.com/moto-ogs/project-phoenix/modules/identityaccess/inbound/parentauth"
	"github.com/moto-ogs/project-phoenix/modules/peopledirectory"
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

// staffPortalInvitationContractMounts lists the staff portal's routes the
// root mounts beside /api, below /auth (#2352): the invitations, the role,
// permission and account administration and the account's own settings.
// People Directory owns the caregiver capability's answer, so its type is
// named here.
func staffPortalInvitationContractMounts() []contractMount {
	return []contractMount{
		{"/auth/invitations", accountHTTP.InvitationRouteContracts()},
		{"/auth", accountHTTP.AdminRouteContracts(peopledirectory.CaregiverCapabilityState{})},
		{"/auth", accountHTTP.SelfServiceRouteContracts()},
	}
}

// secondFactorContractMounts lists the caterer's and the parents' reading and
// starting of their second factor and their remembered devices (#2352).
func secondFactorContractMounts() []contractMount {
	return []contractMount{
		{"/caterer", catererAuthHTTP.SecondFactorRouteContracts()},
		{"/parent", parentAuthHTTP.SecondFactorRouteContracts()},
	}
}
