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
// bootstrap is served by its route file (RouteFileContracts). The upload is a public upload of the form;
// the backend counts the attempt by IP before it reads the body. The signature proof is a
// public file at /requests/{statusToken}/signature-proof; the status read
// forwards no format, so its ?format=pdf stays off the proxy.
func PublicRouteContracts() []common.RouteContract {
	portals := publicPortal
	lateInvite := []common.QueryParam{{Name: "late_invite", Kind: common.QueryString}}
	request := "/requests/{statusToken}"
	return []common.RouteContract{
		{Method: "GET", Pattern: "/phases/public/{tenantSlug}", Portals: portals, Response: []PublicPhase{}},
		{Method: "GET", Pattern: "/legal/{tenantSlug}", Portals: portals, Query: lateInvite, Response: PublicLegalTextsResponse{}},
		{Method: "GET", Pattern: "/legal/{tenantSlug}/{phaseId}", Portals: portals, Query: lateInvite, Response: PublicLegalTextsResponse{}},
		{Method: "POST", Pattern: "/{tenantSlug}/uploads", Portals: portals, Multipart: true, Response: UploadReceipt{},
			MaxBodyBytes: MaxUploadBodyBytes, TooLargeCode: common.CodeEnrollmentUploadInvalid,
			PublicUpload: "the public enrollment form takes proofs before any account exists; the backend limits attempts per IP and school"},
		{Method: "POST", Pattern: "/{tenantSlug}/submit", Portals: portals, Query: lateInvite, Request: SubmitEnrollmentRequest{}, Response: SubmitEnrollmentResponse{}, MaxBodyBytes: publicFormBodyBytes},
		{Method: "GET", Pattern: request, Portals: portals, Response: StatusResponse{}},
		{Method: "PATCH", Pattern: request, Portals: portals, Request: EditPatchRequest{}, Response: EditPatchResponse{}, MaxBodyBytes: publicFormBodyBytes},
		{Method: "PUT", Pattern: request, Portals: portals, Request: SubmitEnrollmentRequest{}, Response: SubmitEnrollmentResponse{}, MaxBodyBytes: publicFormBodyBytes},
		{Method: "GET", Pattern: request + "/signature-proof", Portals: portals, File: true,
			PublicFile: "the status link of the mail is the parents' only credential for their own proof"},
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

// PublicHolidayRegistrationRouteContracts registers the one link of a
// published holiday period (#4661) and the status link of a sent
// registration (#6676), relative to /traeger/holiday-registrations. Both run
// without a session, as do the form documents the period's link opens and
// the proof upload.
func PublicHolidayRegistrationRouteContracts() []common.RouteContract {
	portals := publicPortal
	return []common.RouteContract{
		{Method: "GET", Pattern: "/status/{statusToken}", Portals: portals, Response: HolidayRegistrationStatusResponse{}},
		{Method: "GET", Pattern: "/{token}", Portals: portals, Response: PublicHolidayRegistrationOfferResponse{}},
		{Method: "POST", Pattern: "/{token}", Portals: portals, Request: HolidayRegistrationRequest{}, Response: HolidayRegistrationSubmitResponse{}, MaxBodyBytes: publicFormBodyBytes},
		{Method: "POST", Pattern: "/{token}/uploads", Portals: portals, Multipart: true, Response: UploadReceipt{},
			MaxBodyBytes: MaxUploadBodyBytes, TooLargeCode: common.CodeEnrollmentUploadInvalid,
			PublicUpload: "the published link of a holiday period takes proofs of benefits; the backend limits attempts per IP and Träger"},
		{Method: "GET", Pattern: "/{token}/documents/{documentId}", Portals: portals, File: true,
			PublicFile: "the published link of a holiday period opens the form documents it lists"},
	}
}

// RouteFileContracts registers the form bootstrap of the staff portal and
// the signed-in person's autofill (#7808), relative to /api/enrollment. The
// bootstrap's route file adds the autofill of a signed-in staff member to
// the public form, so no proxy allowlist names either route.
func RouteFileContracts() []common.RouteContract {
	portals := []common.PortalScope{common.PortalTenant}
	return []common.RouteContract{
		{Method: "GET", Pattern: "/form-bootstrap/public/{tenantSlug}/{phaseId}", BrowserPath: "/api/enrollment/form-bootstrap/public/{tenantSlug}/{phaseId}", BrowserOwnContract: true, Portals: portals,
			RouteFile: "the route file adds the signed-in staff member's profile to the public form",
			Query:     []common.QueryParam{{Name: "late_invite", Kind: common.QueryString}}, Response: PublicEnrollmentFormBootstrapResponse{}},
		{Method: "GET", Pattern: "/me/profile", Portals: portals,
			RouteFile: "read only by the form bootstrap's route file", Response: common.GuardianProfileResponse{}},
	}
}
