package enrollmenthttp

import (
	"github.com/moto-ogs/project-phoenix/api/common"
	capability "github.com/moto-ogs/project-phoenix/modules/enrollment"
)

// publicPortal admits the requests of a mailed link or the public form,
// without a session (#2352).
var publicPortal = []common.PortalScope{common.PortalPublic}

// Body limits of the public writes, which no session bounds: a whole form
// carries its answers and the drawn signature as base64 PNG; the others carry
// a few fields.
const (
	publicFormBodyBytes    = 2 << 20
	publicMessageBodyBytes = 64 << 10
	publicSmallBodyBytes   = 4 << 10
)

// PublicRouteContracts registers the parent-facing routes that reach the
// backend without a session (#2352), relative to /api/enrollment. The form
// bootstrap and the upload keep their BFF files; GET /requests/{statusToken}
// with ?format=pdf is the signature proof's file route, so its contract
// forwards no format.
func PublicRouteContracts() []common.RouteContract {
	portals := publicPortal
	lateInvite := []common.QueryParam{{Name: "late_invite", Kind: common.QueryString}}
	request := "/requests/{statusToken}"
	return []common.RouteContract{
		{Method: "GET", Pattern: "/phases/public/{tenantSlug}", Portals: portals, Response: []PublicPhase{}},
		{Method: "GET", Pattern: "/legal/{tenantSlug}", Portals: portals, Query: lateInvite, Response: PublicLegalTextsResponse{}},
		{Method: "GET", Pattern: "/legal/{tenantSlug}/{phaseId}", Portals: portals, Query: lateInvite, Response: PublicLegalTextsResponse{}},
		{Method: "POST", Pattern: "/{tenantSlug}/submit", Portals: portals, Query: lateInvite, Request: SubmitEnrollmentRequest{}, Response: SubmitEnrollmentResponse{}, MaxBodyBytes: publicFormBodyBytes},
		{Method: "GET", Pattern: request, Portals: portals, Response: StatusResponse{}},
		{Method: "PATCH", Pattern: request, Portals: portals, Request: EditPatchRequest{}, Response: EditPatchResponse{}, MaxBodyBytes: publicFormBodyBytes},
		{Method: "PUT", Pattern: request, Portals: portals, Request: SubmitEnrollmentRequest{}, Response: SubmitEnrollmentResponse{}, MaxBodyBytes: publicFormBodyBytes},
		{Method: "GET", Pattern: request + "/edit-bootstrap", Portals: portals, Response: EditBootstrapResponse{}},
		{Method: "GET", Pattern: request + "/form-labels", Portals: portals, Response: FormLabelsResponse{}},
		{Method: "GET", Pattern: request + "/change-requests", Portals: portals, Response: []ChangeRequestResponse{}},
		{Method: "POST", Pattern: request + "/change-requests", Portals: portals, Request: CreateChangeRequestRequest{}, Response: ChangeRequestResponse{}, MaxBodyBytes: publicFormBodyBytes},
		{Method: "POST", Pattern: request + "/change-requests/{changeRequestId}/messages", Portals: portals, Request: ChangeRequestMessageRequest{}, Response: ChangeRequestResponse{}, MaxBodyBytes: publicMessageBodyBytes},
		{Method: "POST", Pattern: request + "/withdraw", Portals: portals, Request: WithdrawRequest{}, NoData: true, MaxBodyBytes: publicSmallBodyBytes},
		{Method: "POST", Pattern: request + "/confirm-renewal", Portals: portals, Request: ConfirmRenewalRequest{}, Response: ConfirmRenewalResponse{}, MaxBodyBytes: publicMessageBodyBytes},
		{Method: "GET", Pattern: request + "/family-children", Portals: portals, Response: capability.RegistrationFamilyChildren{}},
		{Method: "PUT", Pattern: request + "/family-children", Portals: portals, Request: StatusFamilyChildrenRequest{}, Response: capability.RegistrationFamilyChildren{}, MaxBodyBytes: publicSmallBodyBytes},
	}
}
