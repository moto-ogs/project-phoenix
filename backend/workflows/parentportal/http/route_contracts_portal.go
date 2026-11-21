package parent

import (
	"github.com/moto-ogs/project-phoenix/api/common"
	calendarService "github.com/moto-ogs/project-phoenix/modules/schoolcalendar/portal"
	parentService "github.com/moto-ogs/project-phoenix/workflows/parentportal"
)

// UnreadCountResponse counts the guardian's unread news or messages.
type UnreadCountResponse struct {
	UnreadCount int `json:"unread_count"`
}

// AnnouncementReadResponse confirms that a news item was marked read.
type AnnouncementReadResponse struct {
	Read bool `json:"read"`
}

// AnnouncementAcknowledgedResponse confirms the acknowledgement of a news item.
type AnnouncementAcknowledgedResponse struct {
	Acknowledged bool `json:"acknowledged"`
}

// AnnouncementAnsweredResponse tells whether a poll answer holds an option.
type AnnouncementAnsweredResponse struct {
	Answered bool `json:"answered"`
}

// DeclarationRecordedResponse is the stored declaration and whether this call
// stored it.
type DeclarationRecordedResponse struct {
	Created    bool                                `json:"created"`
	Submission parentDeclarationSubmissionResponse `json:"submission"`
}

// PushPublicKeyResponse carries the VAPID key of the guardian's push
// subscriptions.
type PushPublicKeyResponse struct {
	PublicKey string `json:"public_key"`
}

// ForeignContractTypes are the types of answers other owners render for the
// portal: Enrollment the form load and submission, Care Contract the contract
// to sign. The root names them, as it binds the renderers (ADR 0270).
type ForeignContractTypes struct {
	EnrollmentBootstrap, EnrollmentSubmitRequest, EnrollmentSubmit, ContractSigning any
	// EnrollmentUpload is Enrollment's receipt of a proof the form uploads,
	// with the body bound and the code of a too large file.
	EnrollmentUpload             any
	EnrollmentUploadMaxBodyBytes int
	EnrollmentUploadTooLargeCode string
}

// PortalRouteContracts registers the typed contract of the guardian's routes
// below /me and of the enrollment and holiday forms (ADR 0270), with
// patterns relative to the /parent mount.
func PortalRouteContracts(foreign ForeignContractTypes) []common.RouteContract {
	var routes []common.RouteContract
	routes = append(routes, accountRouteContracts()...)
	routes = append(routes, documentRouteContracts(foreign.ContractSigning)...)
	routes = append(routes, communicationRouteContracts()...)
	routes = append(routes, childStatusRouteContracts()...)
	routes = append(routes, childCareRouteContracts()...)
	routes = append(routes, childWriteRouteContracts()...)
	routes = append(routes, accountWriteRouteContracts()...)
	routes = append(routes, childMasterDataRouteContracts()...)
	return append(routes, formRouteContracts(foreign)...)
}

func accountRouteContracts() []common.RouteContract {
	portals := []common.PortalScope{common.PortalParent}
	page := []common.QueryParam{{Name: "limit", Kind: common.QueryInt}, {Name: "cursor", Kind: common.QueryString}}
	return []common.RouteContract{
		{Method: "GET", Pattern: "/me/children", Portals: portals, Response: []ChildResponse{}},
		{Method: "GET", Pattern: "/me/profile", Portals: portals, Response: ParentProfileResponse{}},
		{Method: "PUT", Pattern: "/me/profile", Portals: portals, Request: UpdateParentProfileRequest{}, Response: ParentProfileResponse{}},
		{Method: "GET", Pattern: "/me/push/public-key", Portals: portals, Response: PushPublicKeyResponse{}},
		{Method: "POST", Pattern: "/me/pwa-usage", Portals: portals, NoData: true},
		{Method: "GET", Pattern: "/me/notifications/feed/", Portals: portals, Query: page, Response: notificationFeedPageResponse{}},
		{Method: "GET", Pattern: "/me/notifications/feed/unread-count", Portals: portals, Response: notificationFeedCountResponse{}},
		{Method: "POST", Pattern: "/me/notifications/feed/read-all", Portals: portals, Response: notificationFeedCountResponse{}},
		{Method: "POST", Pattern: "/me/notifications/feed/{id}/read", Portals: portals, Response: notificationFeedCountResponse{}},
		{Method: "GET", Pattern: "/me/holiday-registrations", Portals: portals, Response: []HolidayRegistrationOfferResponse{}},
		{Method: "GET", Pattern: "/me/holiday-registration-entries", Portals: portals, Response: HolidayRegistrationEntriesResponse{}},
	}
}

func documentRouteContracts(signing any) []common.RouteContract {
	portals := []common.PortalScope{common.PortalParent}
	contract := "/me/documents/{organizationId}/contracts/{contractId}"
	return []common.RouteContract{
		{Method: "GET", Pattern: "/me/documents", Portals: portals, Response: []BillingDocumentResponse{}},
		{Method: "GET", Pattern: "/me/documents/contracts", Portals: portals, Response: []BillingDocumentResponse{}},
		{Method: "GET", Pattern: "/me/documents/shared", Portals: portals, Response: []SharedDocumentResponse{}},
		{Method: "GET", Pattern: contract + "/signing", Portals: portals, Response: signing},
		{Method: "POST", Pattern: contract + "/sign", Portals: portals, Request: ContractSignRequest{}, Response: signing},
		{Method: "POST", Pattern: contract + "/sepa-mandate/preview", Portals: portals, Request: parentService.SEPAMandateInput{}, Response: parentService.SEPAMandateText{}},
		{Method: "POST", Pattern: contract + "/sepa-mandate/revoke", Portals: portals, Response: parentService.SEPAMandateView{}},
		// The stored PDFs and the shared files of the inbox (#4671, #4678,
		// #4692); the handlers refuse a non-numeric ID with 400.
		{Method: "GET", Pattern: "/me/documents/{organizationId}/{documentId}/pdf", Portals: portals, File: true},
		{Method: "GET", Pattern: contract + "/pdf", Portals: portals, File: true},
		{Method: "GET", Pattern: "/me/documents/{organizationId}/shared/{documentId}/file", Portals: portals, File: true},
	}
}

func communicationRouteContracts() []common.RouteContract {
	portals := []common.PortalScope{common.PortalParent}
	news := "/me/news/{announcementId}"
	child := "/me/messages/children/{studentId}"
	return []common.RouteContract{
		{Method: "GET", Pattern: "/me/messages", Portals: portals, Response: []ThreadSummaryResponse{}},
		{Method: "GET", Pattern: "/me/messages/unread-count", Portals: portals, Response: UnreadCountResponse{}},
		{Method: "GET", Pattern: child + "/threads", Portals: portals, Response: []ThreadSummaryResponse{}},
		{
			Method: "GET", Pattern: child, Portals: portals,
			Query:    []common.QueryParam{{Name: "audience", Kind: common.QueryString}},
			Response: ThreadViewResponse{},
		},
		{Method: "POST", Pattern: child, Portals: portals, Request: PostMessageRequest{}, Response: ThreadViewResponse{}},
		// The attachments stream through the portal's proxy (#2352).
		{
			Method: "POST", Pattern: child + "/attachments", Portals: portals, Multipart: true,
			MaxBodyBytes: int(common.MessageAttachmentBodyBytes(maxMessageAttachmentBytes)),
			TooLargeCode: common.CodeFilesFileTooLarge, Response: messageAttachmentResponse{},
		},
		{
			Method: "GET", Pattern: child + "/attachments/{attachmentId}/download", Portals: portals,
			Query: []common.QueryParam{{Name: "inline", Kind: common.QueryString}}, File: true,
		},
		{Method: "GET", Pattern: "/me/messages/group-threads", Portals: portals, Response: []GroupThreadSummaryResponse{}},
		{Method: "GET", Pattern: "/me/messages/group-threads/{groupThreadId}", Portals: portals, Response: GroupThreadViewResponse{}},
		{Method: "GET", Pattern: "/me/news", Portals: portals, Response: []AnnouncementResponse{}},
		{Method: "GET", Pattern: "/me/news/unread-count", Portals: portals, Response: UnreadCountResponse{}},
		{Method: "POST", Pattern: news + "/read", Portals: portals, Request: stampRequest{}, Response: AnnouncementReadResponse{}},
		{Method: "POST", Pattern: news + "/acknowledge", Portals: portals, Request: stampRequest{}, Response: AnnouncementAcknowledgedResponse{}},
		{Method: "POST", Pattern: news + "/respond", Portals: portals, Request: respondRequest{}, Response: AnnouncementAnsweredResponse{}},
		{
			Method: "POST", Pattern: news + "/declaration", Portals: portals,
			NoRetryAfterRenewal: "a renewed session would send the account password twice",
			Request:             declarationRequest{}, Response: DeclarationRecordedResponse{},
		},
		{
			Method: "GET", Pattern: news + "/declaration/proof", Portals: portals,
			Query:    []common.QueryParam{{Name: "student_id", Kind: common.QueryID}},
			Response: declarationProofResponse{},
		},
		{
			Method: "GET", Pattern: news + "/declaration/proof/pdf", Portals: portals,
			Query: []common.QueryParam{{Name: "student_id", Kind: common.QueryID}}, File: true,
		},
	}
}

func childStatusRouteContracts() []common.RouteContract {
	portals := []common.PortalScope{common.PortalParent}
	child := "/me/children/{studentId}"
	sharing := child + "/request-sharing/{requestType}/{requestId}"
	return []common.RouteContract{
		{Method: "GET", Pattern: child + "/features", Portals: portals, Response: ChildFeaturesResponse{}},
		{Method: "GET", Pattern: child + "/today", Portals: portals, Response: TodayStatusResponse{}},
		{Method: "GET", Pattern: child + "/consents", Portals: portals, Response: []ChildConsentResponse{}},
		{
			Method: "GET", Pattern: child + "/meal-plan", Portals: portals,
			Query:    []common.QueryParam{{Name: "week_start", Kind: common.QueryDate}},
			Response: []MealPlanEntryResponse{},
		},
		{Method: "GET", Pattern: child + "/excused-requests", Portals: portals, Response: []ParentExcusedRequestResponse{}},
		{Method: "PUT", Pattern: child + "/excused-requests/{requestId}", Portals: portals, Request: EditExcusedRequestBody{}, Response: ParentExcusedRequestResponse{}},
		{Method: "GET", Pattern: child + "/requests/{requestType}/{requestId}/events", Portals: portals, Response: []ParentRequestEventResponse{}},
		{Method: "GET", Pattern: sharing, Portals: portals, Response: requestSharingResponse{}},
		{Method: "PUT", Pattern: sharing, Portals: portals, Request: requestSharingBody{}, Response: requestSharingResponse{}},
		{Method: "GET", Pattern: child + "/request-sharing-options", Portals: portals, Response: requestSharingResponse{}},
		{Method: "GET", Pattern: child + "/parent-conferences", Portals: portals, Response: []calendarService.ParentConferenceOffer{}},
	}
}

func childCareRouteContracts() []common.RouteContract {
	portals := []common.PortalScope{common.PortalParent}
	child := "/me/children/{studentId}"
	return []common.RouteContract{
		{Method: "GET", Pattern: child + "/pickup-change-requests", Portals: portals, Response: []PickupChangeRequestResponse{}},
		{Method: "PUT", Pattern: child + "/pickup-change-requests/{requestId}", Portals: portals, Request: EditPickupChangeRequestBody{}, Response: PickupChangeRequestResponse{}},
		{Method: "GET", Pattern: child + "/care-schedule", Portals: portals, Response: CareScheduleResponse{}},
		{Method: "POST", Pattern: child + "/care-schedule/requests", Portals: portals, Request: CareScheduleRequestBody{}, Response: CareScheduleResponse{}},
		{Method: "PUT", Pattern: child + "/care-schedule/requests/{requestId}", Portals: portals, Request: EditCareScheduleRequestBody{}, Response: CareScheduleResponse{}},
		{Method: "GET", Pattern: child + "/care-offerings", Portals: portals, Response: CareOfferingsResponse{}},
		{
			Method: "GET", Pattern: child + "/care-offerings/catalog", Portals: portals,
			Query:    []common.QueryParam{{Name: "effective_from", Kind: common.QueryDate}},
			Response: OfferingCatalogResponse{},
		},
		{Method: "POST", Pattern: child + "/care-offerings/requests", Portals: portals, Request: OfferingChangeRequestBody{}, Response: CareOfferingsResponse{}},
		{Method: "PUT", Pattern: child + "/care-offerings/requests/{requestId}", Portals: portals, Request: EditOfferingChangeRequestBody{}, Response: CareOfferingsResponse{}},
		{Method: "GET", Pattern: child + "/courses", Portals: portals, Response: CoursesResponse{}},
		{Method: "POST", Pattern: child + "/courses/requests", Portals: portals, Request: CourseRequestBody{}, Response: CoursesResponse{}},
		{Method: "POST", Pattern: child + "/courses/requests/{requestId}/withdraw", Portals: portals, Response: CoursesResponse{}},
	}
}

func childMasterDataRouteContracts() []common.RouteContract {
	portals := []common.PortalScope{common.PortalParent}
	child := "/me/children/{studentId}"
	guardian := child + "/guardians/{guardianProfileId}"
	return []common.RouteContract{
		{Method: "GET", Pattern: child + "/master-data", Portals: portals, Response: MasterDataResponse{}},
		{Method: "PATCH", Pattern: child + "/master-data/{target}/{field}", Portals: portals, Request: UpdateMasterDataRequest{}, Response: MasterDataResponse{}},
		{Method: "GET", Pattern: child + "/master-data/requests", Portals: portals, Response: []MasterDataChangeResponse{}},
		{Method: "POST", Pattern: child + "/master-data/requests", Portals: portals, Request: MasterDataChangeRequestBody{}, Response: []MasterDataChangeResponse{}},
		{Method: "PUT", Pattern: child + "/master-data/requests/{requestId}", Portals: portals, Request: EditMasterDataRequestBody{}, Response: MasterDataChangeResponse{}},
		{Method: "GET", Pattern: child + "/related-accounts", Portals: portals, Response: []relatedAccountResponse{}},
		{Method: "POST", Pattern: child + "/related-accounts", Portals: portals, Request: inviteRelatedAccountRequest{}, Response: inviteRelatedAccountResponse{}},
		{Method: "GET", Pattern: child + "/guardians", Portals: portals, Response: []childGuardianResponse{}},
		{Method: "POST", Pattern: child + "/guardians", Portals: portals, Request: createGuardianContactRequest{}, Response: childGuardianResponse{}},
		{Method: "PUT", Pattern: guardian + "/contact", Portals: portals, Request: updateGuardianContactRequest{}, Response: childGuardianResponse{}},
		{Method: "PUT", Pattern: guardian + "/pickup", Portals: portals, Request: updateGuardianRelationshipRequest{}, Response: childGuardianResponse{}},
		{Method: "POST", Pattern: guardian + "/pickup-permission-requests", Portals: portals, Request: pickupPermissionRequestBody{}, Response: pickupPermissionRequestResponse{}},
		{Method: "GET", Pattern: child + "/pickup-permission-requests", Portals: portals, Response: []pickupPermissionRequestResponse{}},
		{Method: "GET", Pattern: child + "/pickup-requests/{requestId}/proof/pdf", Portals: portals, File: true},
		{Method: "POST", Pattern: child + "/pickup-signature-statement", Portals: portals, Request: pickupSignatureStatementRequest{}, Response: pickupSignatureStatementResponse{}},
	}
}

func formRouteContracts(foreign ForeignContractTypes) []common.RouteContract {
	portals := []common.PortalScope{common.PortalParent}
	lateInvite := []common.QueryParam{{Name: "late_invite", Kind: common.QueryString}}
	return []common.RouteContract{
		{Method: "GET", Pattern: "/enrollments/{tenantSlug}/profile", Portals: portals, Response: common.GuardianProfileResponse{}},
		{Method: "GET", Pattern: "/enrollments/{tenantSlug}/bootstrap/{phaseId}", Portals: portals, Query: lateInvite, Response: foreign.EnrollmentBootstrap},
		{Method: "POST", Pattern: "/enrollments/{tenantSlug}/submit", Portals: portals, Query: lateInvite, Request: foreign.EnrollmentSubmitRequest, Response: foreign.EnrollmentSubmit},
		{Method: "POST", Pattern: "/enrollments/{tenantSlug}/uploads", Portals: portals, Multipart: true, Response: foreign.EnrollmentUpload,
			MaxBodyBytes: foreign.EnrollmentUploadMaxBodyBytes, TooLargeCode: foreign.EnrollmentUploadTooLargeCode},
		{Method: "GET", Pattern: "/holiday-registrations/{token}/family", Portals: portals, Response: HolidayRegistrationFamilyResponse{}},
	}
}
