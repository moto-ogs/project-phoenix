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
// staff-view preview's candidates, the account provisioning and the own
// password change. The passkey sign-in (/auth/passkeys/login/…) stays
// unregistered: it mints a session, which only its own route file installs.
func SelfServiceRouteContracts() []common.RouteContract {
	portals := []common.PortalScope{common.PortalTenant}
	route := func(method, pattern string, request, response any) common.RouteContract {
		return common.RouteContract{Method: method, Pattern: pattern, Portals: portals, Request: request, Response: response, NoData: response == nil}
	}
	enrollment := route("POST", "/passkeys/enrollment/challenge", nil, identityaccess.PasskeyEnrollmentChallenge{})
	enrollment.NoRetryAfterRenewal = "a renewed session would mail the code twice"
	registerOptions := route("POST", "/passkeys/register/options", passkeyRegisterOptionsRequest{}, identityaccess.PasskeyCeremonyOptions{})
	registerOptions.NoRetryAfterRenewal = "a renewed session would send the mailed code twice"
	changePassword := route("POST", "/password", ChangePasswordRequest{}, nil)
	changePassword.NoRetryAfterRenewal = "a renewed session would send the current password twice"
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
		changePassword,
	}
}

// publicLinkBodyBytes bounds the body of a public link's write: two
// passwords.
const publicLinkBodyBytes = 4 << 10

// PublicRouteContracts registers the token-proved links and the school list
// below /auth as public (#2352): each carries no session, the link or the
// lookup is the whole permission. The tenant resolve joined them with
// #2342, once its identifiers travel as strings.
func PublicRouteContracts() []common.RouteContract {
	portals := []common.PortalScope{common.PortalPublic}
	return []common.RouteContract{
		{Method: "GET", Pattern: "/invitations/{token}", Portals: portals, Response: InvitationValidationResponse{}},
		{Method: "GET", Pattern: "/guardian-invitations/{token}", Portals: portals, Response: GuardianInvitationValidateResponse{}},
		{Method: "POST", Pattern: "/guardian-invitations/{token}/accept", Portals: portals, Request: AcceptGuardianInvitationRequest{}, Response: AcceptGuardianInvitationResponse{}, MaxBodyBytes: publicLinkBodyBytes},
		{Method: "GET", Pattern: "/holiday-parent-setups/{token}", Portals: portals, Response: HolidayParentSetupResponse{}},
		{Method: "POST", Pattern: "/holiday-parent-setups/{token}", Portals: portals, Request: CompleteHolidayParentSetupRequest{}, Response: CompleteHolidayParentSetupResponse{}, MaxBodyBytes: publicLinkBodyBytes},
		{Method: "GET", Pattern: "/tenants", Portals: portals, Response: []PublicTenantResponse{}},
		// The school layout and the login resolve the school before a
		// session exists (#2342).
		{Method: "GET", Pattern: "/tenant/resolve", Portals: portals, Query: []common.QueryParam{{Name: "slug", Kind: common.QueryString}}, Response: TenantResolveResponse{}},
	}
}

// SessionRouteContracts registers the staff portal's session steps below
// /auth (#7808): sign-in, second factor, passkey sign-in, renewal, check,
// switch, preview and sign-out, and the invitation accept that signs the
// owner in. Each answer carries or ends tokens, so only the portal's route
// file reads it and no proxy allowlist names the route.
func SessionRouteContracts() []common.RouteContract {
	portals := []common.PortalScope{common.PortalTenant}
	step := func(pattern string, request, response any) common.RouteContract {
		return common.RouteContract{
			Method: "POST", Pattern: pattern, Portals: portals, RouteFile: common.RouteFileSession,
			Request: request, Response: response, NoData: response == nil, Plain: response != nil,
		}
	}
	accept := step("/invitations/{token}/accept", AcceptInvitationRequest{}, AcceptInvitationResponse{})
	accept.Plain = false
	accept.RouteFile = "the route file attaches the signed-in owner's session to the accept"
	end := step("/staff-preview/end", StaffPreviewEndRequest{}, nil)
	return []common.RouteContract{
		step("/login", LoginRequest{}, portalauth.LoginResponse{}),
		step("/logout", nil, nil),
		step("/refresh", nil, portalauth.TokenResponse{}),
		step("/session/validate", SessionValidationRequest{}, SessionClaimsResponse{}),
		step("/mfa/enroll/start", nil, portalauth.EnrollStartResponse{}),
		step("/mfa/enroll/confirm", common.MFAVerifyRequest{}, portalauth.TokenResponse{}),
		step("/mfa/resend", common.MFAResendRequest{}, common.MFAResendResponse{}),
		step("/mfa/verify", common.MFAVerifyRequest{}, portalauth.TokenResponse{}),
		step("/passkeys/login/options", passkeyLoginOptionsRequest{}, identityaccess.PasskeyCeremonyOptions{}),
		step("/passkeys/login/verify", common.PasskeyVerifyRequest{}, portalauth.LoginResponse{}),
		step("/switch-tenant", SwitchTenantRequest{}, portalauth.TokenResponse{}),
		step("/staff-preview", StaffPreviewStartRequest{}, StaffPreviewStartResponse{}),
		end,
		accept,
	}
}
