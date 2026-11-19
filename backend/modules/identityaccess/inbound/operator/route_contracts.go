package operator

import (
	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess"
)

// RouteContracts registers the operator's profile and password, its own
// remembered devices and passkeys, the caterer list, the operator team and
// the second-factor administration (ADR 0270, #2352), with patterns relative
// to the /operator mount. The passkey sign-in mints a session and stays
// unregistered.
func RouteContracts() []common.RouteContract {
	operator := []common.PortalScope{common.PortalOperator}
	route := func(method, pattern string, request, response any) common.RouteContract {
		return common.RouteContract{Method: method, Pattern: pattern, Portals: operator, Request: request, Response: response, NoData: response == nil}
	}
	return []common.RouteContract{
		route("GET", "/profile/", nil, OperatorResponse{}),
		route("PUT", "/profile/", UpdateProfileRequest{}, OperatorResponse{}),
		{
			Method: "POST", Pattern: "/profile/email-change", Portals: operator, Request: InitiateEmailChangeRequest{}, NoData: true,
			NoRetryAfterRenewal: "a renewed session would send the current password twice",
		},
		{
			Method: "POST", Pattern: "/profile/password", Portals: operator, Request: OperatorPasswordChangeRequest{}, NoData: true,
			NoRetryAfterRenewal: "a renewed session would send the current password twice",
		},
		route("GET", "/auth/mfa/trusted-devices", nil, []common.TrustedDeviceDTO{}),
		route("DELETE", "/auth/mfa/trusted-devices/{deviceId}", nil, nil),
		route("GET", "/auth/passkeys", nil, []identityaccess.PasskeyCredentialSummary{}),
		route("DELETE", "/auth/passkeys/{passkeyId}", nil, nil),
		{
			Method: "POST", Pattern: "/auth/passkeys/enrollment/challenge", Portals: operator, Response: identityaccess.PasskeyEnrollmentChallenge{},
			NoRetryAfterRenewal: "a renewed session would mail the code twice",
		},
		{
			Method: "POST", Pattern: "/auth/passkeys/register/options", Portals: operator, Request: operatorPasskeyRegisterOptionsRequest{}, Response: identityaccess.PasskeyCeremonyOptions{},
			NoRetryAfterRenewal: "a renewed session would send the mailed code twice",
		},
		// A WebAuthn attestation of a one-time challenge: the renewal may
		// repeat it, as in the staff portal.
		route("POST", "/auth/passkeys/register/verify", operatorPasskeyRegisterVerifyRequest{}, identityaccess.PasskeyCredentialSummary{}),
		route("GET", "/caterers", nil, []CatererSecurityResponse{}),
		route("DELETE", "/caterers/{id}/accounts/{accountId}/mfa", MFAAdminResetRequest{}, nil),
		route("GET", "/invitations/", nil, InvitationsListResponse{}),
		route("POST", "/invitations/", CreateInvitationRequest{}, nil),
		route("POST", "/invitations/{id}/resend", nil, nil),
		route("DELETE", "/invitations/{id}", nil, nil),
		route("POST", "/operators/{id}/deactivate", nil, OperatorListItem{}),
		route("POST", "/operators/{id}/reactivate", nil, OperatorListItem{}),
		route("GET", "/accounts/{accountId}/tenants", nil, []AccountTenantAccessEntry{}),
		route("POST", "/accounts/{accountId}/tenants", grantAccountTenantAccessRequest{}, []AccountTenantAccessEntry{}),
		route("GET", "/accounts/{accountId}/tenants/{tenantId}/roles", nil, []RoleOption{}),
		route("PUT", "/accounts/{accountId}/tenants/{tenantId}", updateAccountTenantRoleRequest{}, []AccountTenantAccessEntry{}),
		route("DELETE", "/accounts/{accountId}/tenants/{tenantId}", nil, []AccountTenantAccessEntry{}),
		route("GET", "/accounts/{accountId}/mfa/global-override", nil, MFAGlobalOverrideStateResponse{}),
		route("PUT", "/accounts/{accountId}/mfa/global-override", MFAAdminOverrideSetRequest{}, nil),
		route("GET", "/schools/{id}/accounts/{accountId}/mfa/", nil, MFAAdminStateResponse{}),
		route("DELETE", "/schools/{id}/accounts/{accountId}/mfa/", MFAAdminResetRequest{}, nil),
		route("PUT", "/schools/{id}/accounts/{accountId}/mfa/override", MFAAdminOverrideSetRequest{}, nil),
	}
}

// emailConfirmBodyBytes bounds the confirmation body: the token of the link.
const emailConfirmBodyBytes = 4 << 10

// PublicRouteContracts registers the confirmation of a new address, which
// the mailed link opens without a session (#2352), relative to /operator.
func PublicRouteContracts() []common.RouteContract {
	return []common.RouteContract{{
		Method: "POST", Pattern: "/auth/email-confirm", Portals: []common.PortalScope{common.PortalPublic},
		Request: ConfirmEmailChangeRequest{}, NoData: true, MaxBodyBytes: emailConfirmBodyBytes,
	}}
}
