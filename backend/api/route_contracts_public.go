package api

import (
	"github.com/moto-ogs/project-phoenix/api/common"
	careContractHTTP "github.com/moto-ogs/project-phoenix/modules/carecontract/http"
	enrollmentHTTP "github.com/moto-ogs/project-phoenix/modules/enrollment/http"
	accountHTTP "github.com/moto-ogs/project-phoenix/modules/identityaccess/inbound/account"
	catererAuthHTTP "github.com/moto-ogs/project-phoenix/modules/identityaccess/inbound/catererauth"
	identityOperatorAPI "github.com/moto-ogs/project-phoenix/modules/identityaccess/inbound/operator"
	parentAuthHTTP "github.com/moto-ogs/project-phoenix/modules/identityaccess/inbound/parentauth"
	parentBillingHTTP "github.com/moto-ogs/project-phoenix/modules/parentbilling/http"
	"github.com/moto-ogs/project-phoenix/modules/peopledirectory"
	schoolPortalHTTP "github.com/moto-ogs/project-phoenix/modules/schoolportal"
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
		{holidayRegistrationPath, enrollmentHTTP.PublicHolidayRegistrationRouteContracts()},
		{holidayQuoteMount, parentBillingHTTP.HolidayQuoteRouteContracts()},
		{"/public/care-contract-signing", careContractHTTP.SigningRouteContracts()},
		{"/operator", identityOperatorAPI.PublicRouteContracts()},
		// The reset link and its request in every portal with a password
		// reset; the operator's has none.
		{"/auth", common.PasswordResetRouteContracts()},
		{"/caterer/auth", common.PasswordResetRouteContracts()},
		{"/parent/auth", common.PasswordResetRouteContracts()},
		{"/school/auth", common.PasswordResetRouteContracts()},
		{"/traeger/auth", common.PasswordResetRouteContracts()},
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

// secondFactorContractMounts lists the caterer's and the parents' second
// factor and the remembered devices of the caterer, parent and school
// portals (#2352).
func secondFactorContractMounts() []contractMount {
	return []contractMount{
		{"/caterer", catererAuthHTTP.SecondFactorRouteContracts()},
		{"/parent", parentAuthHTTP.SecondFactorRouteContracts()},
		{"/school/auth", schoolPortalHTTP.AuthRouteContracts()},
	}
}
