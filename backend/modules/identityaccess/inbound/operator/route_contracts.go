package operator

import "github.com/moto-ogs/project-phoenix/api/common"

// RouteContracts registers the operator's profile, the caterer list, the
// operator team and the second-factor administration (ADR 0270, #2352),
// with patterns relative to the /operator mount.
func RouteContracts() []common.RouteContract {
	operator := []common.PortalScope{common.PortalOperator}
	route := func(method, pattern string, request, response any) common.RouteContract {
		return common.RouteContract{Method: method, Pattern: pattern, Portals: operator, Request: request, Response: response, NoData: response == nil}
	}
	return []common.RouteContract{
		route("GET", "/profile/", nil, OperatorResponse{}),
		route("PUT", "/profile/", UpdateProfileRequest{}, OperatorResponse{}),
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
