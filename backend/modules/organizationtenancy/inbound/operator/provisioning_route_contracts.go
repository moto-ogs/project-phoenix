package operator

import (
	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/modules/organizationtenancy"
)

// ProvisioningRouteContracts registers the operator's provisioning routes
// (ADR 0270, #2352), with patterns relative to the /operator mount.
func ProvisioningRouteContracts(caregiverState any) []common.RouteContract {
	operator := []common.PortalScope{common.PortalOperator}
	route := func(method, pattern string, request, response any) common.RouteContract {
		return common.RouteContract{Method: method, Pattern: pattern, Portals: operator, Request: request, Response: response, NoData: response == nil}
	}
	return []common.RouteContract{
		route("GET", "/accounts", nil, []organizationtenancy.OrganizationAccount{}),
		route("GET", "/roles", nil, []organizationtenancy.SystemRole{}),
		route("GET", "/stats", nil, organizationtenancy.ProvisioningStats{}),
		route("GET", "/devices/", nil, []organizationtenancy.OperatorDevice{}),
		route("POST", "/devices/", createDeviceRequest{}, organizationtenancy.OperatorDevice{}),
		route("POST", "/devices/{id}/set-api-key", setDeviceAPIKeyRequest{}, organizationtenancy.OperatorDevice{}),
		route("GET", "/devices/{id}/transfer-status", nil, organizationtenancy.DeviceTransferStatus{}),
		route("POST", "/devices/{id}/transfer", transferDeviceRequest{}, organizationtenancy.OperatorDevice{}),
		route("GET", "/organizations/", nil, []organizationtenancy.Organization{}),
		route("GET", "/organizations/summaries", nil, []organizationtenancy.OrganizationSummary{}),
		route("POST", "/organizations/", createOrganizationRequest{}, organizationtenancy.Organization{}),
		route("POST", "/organizations/test-traeger", createTestTraegerRequest{}, organizationtenancy.TestTraeger{}),
		route("POST", "/organizations/{id}/restore", nil, nil),
		route("GET", "/organizations/{id}/accounts", nil, []organizationtenancy.OrganizationAccount{}),
		route("GET", "/organizations/{id}/devices", nil, []organizationtenancy.OperatorDevice{}),
		route("GET", "/organizations/{id}/schools", nil, []organizationtenancy.SchoolSummary{}),
		route("GET", "/organizations/{id}/persons", nil, []organizationtenancy.OperatorPerson{}),
		route("GET", "/organizations/{id}/traeger-members", nil, []organizationtenancy.TraegerMember{}),
		route("POST", "/organizations/{id}/traeger-members", traegerMemberRequest{}, organizationtenancy.TraegerMember{}),
		route("GET", "/organizations/{id}/traeger-members/invitations", nil, []organizationtenancy.TraegerInvitation{}),
		route("POST", "/organizations/{id}/traeger-members/invitations", traegerMemberRequest{}, organizationtenancy.TraegerInvitation{}),
		route("POST", "/organizations/{id}/traeger-members/invitations/{invitationId}/resend", nil, organizationtenancy.TraegerInvitation{}),
		route("DELETE", "/organizations/{id}/traeger-members/invitations/{invitationId}", nil, nil),
		// No open order answers null.
		route("GET", "/organizations/{id}/erasure-order", nil, &organizationtenancy.TraegerErasureOrder{}),
		route("POST", "/organizations/{id}/erasure-order", recordTraegerErasureOrderRequest{}, organizationtenancy.TraegerErasureOrder{}),
		route("DELETE", "/organizations/{id}/erasure-order", nil, nil),
		route("PUT", "/organizations/{id}/erasure-order/records", recordTraegerErasureOrderRecordsRequest{}, organizationtenancy.TraegerErasureOrder{}),
		route("GET", "/schools/", nil, []organizationtenancy.School{}),
		route("GET", "/schools/summaries", nil, []organizationtenancy.SchoolSummary{}),
		route("GET", "/schools/required-details", nil, []organizationtenancy.SchoolRequiredDetails{}),
		route("POST", "/schools/", createSchoolRequest{}, organizationtenancy.School{}),
		route("POST", "/schools/{id}/restore", nil, nil),
		route("POST", "/schools/{id}/invite-admin", inviteSchoolAdminRequest{}, operatorInvitationResponse{}),
		route("POST", "/schools/{id}/create-account", createSchoolAccountRequest{}, organizationtenancy.CreatedAccount{}),
		route("GET", "/schools/{id}/accounts", nil, []organizationtenancy.SchoolAccount{}),
		route("GET", "/schools/{id}/devices", nil, []organizationtenancy.OperatorDevice{}),
		route("DELETE", "/devices/{id}", nil, nil),
		route("DELETE", "/persons/{id}", nil, nil),
		route("PUT", "/organizations/{id}", updateOrganizationRequest{}, organizationtenancy.Organization{}),
		route("DELETE", "/organizations/{id}", nil, nil),
		route("DELETE", "/organizations/{id}/traeger-members/{accountId}/mfa", resetTraegerMemberMFARequest{}, nil),
		route("PUT", "/schools/{id}", updateSchoolRequest{}, organizationtenancy.School{}),
		route("DELETE", "/schools/{id}", nil, nil),
		route("GET", "/schools/{id}/persons", nil, []organizationtenancy.OperatorPerson{}),
		route("GET", "/schools/{id}/pwa-usage", nil, organizationtenancy.SchoolPWAUsage{}),
		// People Directory renders the capability; this package hands it on.
		route("GET", "/schools/{id}/accounts/{accountId}/caregiver-capability/", nil, caregiverState),
		route("POST", "/schools/{id}/accounts/{accountId}/caregiver-capability/", updateCaregiverCapabilityRequest{}, caregiverState),
		route("DELETE", "/schools/{id}/accounts/{accountId}/caregiver-capability/", nil, caregiverState),
	}
}

// billingKeyDateCountContract registers the captured key-date counts,
// relative to the /operator/billing mount.
func billingKeyDateCountContract() common.RouteContract {
	return common.RouteContract{Method: "GET", Pattern: "/key-date-counts", Portals: []common.PortalScope{common.PortalOperator}, Response: []billingKeyDateCountResponse{}}
}
