package account

import (
	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess/inbound/portalauth"
)

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

// AdminRouteContracts registers the staff portal's role, permission and
// account administration below /auth (#2352): each prefix the staff proxy's
// fixed list names on its own (/auth/roles, /auth/permissions,
// /auth/accounts), never /auth itself. caregiverState is the type the
// caregiver capability answers with; People Directory owns it, so the root
// names it.
//
// The permission writes stay unregistered: they require the operator's
// platform scope, which no staff portal session carries.
func AdminRouteContracts(caregiverState any) []common.RouteContract {
	portals := []common.PortalScope{common.PortalTenant}
	route := func(method, pattern string, request, response any) common.RouteContract {
		return common.RouteContract{Method: method, Pattern: pattern, Portals: portals, Request: request, Response: response, NoData: response == nil}
	}
	listRoles := route("GET", "/roles/", nil, []RoleResponse{})
	listRoles.Query = []common.QueryParam{{Name: "name", Kind: common.QueryString}}
	listPermissions := route("GET", "/permissions/", nil, []PermissionResponse{})
	listPermissions.Query = []common.QueryParam{
		{Name: "resource", Kind: common.QueryString},
		{Name: "action", Kind: common.QueryString},
	}
	return []common.RouteContract{
		listRoles,
		route("POST", "/roles/", CreateRoleRequest{}, RoleResponse{}),
		route("GET", "/roles/{id}/", nil, RoleResponse{}),
		route("PUT", "/roles/{id}/", UpdateRoleRequest{}, nil),
		route("DELETE", "/roles/{id}/", nil, nil),
		route("GET", "/roles/{roleId}/permissions/", nil, []PermissionResponse{}),
		route("PUT", "/roles/{roleId}/permissions/", ReplaceRolePermissionsRequest{}, nil),
		listPermissions,
		route("GET", "/permissions/{id}/", nil, PermissionResponse{}),
		route("GET", "/accounts/{accountId}/roles/", nil, []RoleResponse{}),
		route("PUT", "/accounts/{accountId}/roles/", ReplaceAccountRoleRequest{}, nil),
		route("GET", "/accounts/{accountId}/mfa/", nil, AccountMFAAdminStateResponse{}),
		route("DELETE", "/accounts/{accountId}/mfa/", MFAAdminOverrideRequest{}, nil),
		route("PUT", "/accounts/{accountId}/mfa/override", AccountMFAAdminOverrideSetRequest{}, nil),
		route("GET", "/accounts/{accountId}/caregiver-capability", nil, caregiverState),
		route("POST", "/accounts/{accountId}/caregiver-capability", EnableCaregiverCapabilityRequest{}, caregiverState),
		route("DELETE", "/accounts/{accountId}/caregiver-capability", nil, caregiverState),
	}
}

// SelfServiceRouteContracts registers the staff portal's own account routes
// below /auth (#2352), each path on its own in the proxy's fixed list: the
// remembered devices, the passkey management, the account's schools, the
// staff-view preview's candidates and the account provisioning. The passkey
// sign-in (/auth/passkeys/login/…) stays unregistered: it mints a session,
// which only its own route file installs.
func SelfServiceRouteContracts() []common.RouteContract {
	portals := []common.PortalScope{common.PortalTenant}
	route := func(method, pattern string, request, response any) common.RouteContract {
		return common.RouteContract{Method: method, Pattern: pattern, Portals: portals, Request: request, Response: response, NoData: response == nil}
	}
	enrollment := route("POST", "/passkeys/enrollment/challenge", nil, identityaccess.PasskeyEnrollmentChallenge{})
	enrollment.NoRetryAfterRenewal = "a renewed session would mail the code twice"
	registerOptions := route("POST", "/passkeys/register/options", passkeyRegisterOptionsRequest{}, identityaccess.PasskeyCeremonyOptions{})
	registerOptions.NoRetryAfterRenewal = "a renewed session would send the mailed code twice"
	return []common.RouteContract{
		route("GET", "/mfa/trusted-devices", nil, []common.TrustedDeviceDTO{}),
		route("DELETE", "/mfa/trusted-devices/{"+portalauth.TrustedDeviceIDParam+"}", nil, nil),
		route("GET", "/passkeys/", nil, []identityaccess.PasskeyCredentialSummary{}),
		enrollment,
		registerOptions,
		// A WebAuthn attestation of a one-time challenge: no password or code
		// the account lock counts, so the renewal may repeat it.
		route("POST", "/passkeys/register/verify", passkeyRegisterVerifyRequest{}, identityaccess.PasskeyCredentialSummary{}),
		route("DELETE", "/passkeys/{passkeyId}", nil, nil),
		route("GET", "/account/tenants", nil, []AccountTenantResponse{}),
		route("GET", "/staff-preview/candidates", nil, []identityaccess.StaffPreviewCandidate{}),
		route("POST", "/register", RegisterRequest{}, AccountResponse{}),
		route("POST", "/link-to-tenant", LinkToTenantRequest{}, LinkedAccountResponse{}),
	}
}
