package enrollmenthttp

import (
	"github.com/moto-ogs/project-phoenix/api/common"
	lists "github.com/moto-ogs/project-phoenix/modules/documentrendering/lists"
	capability "github.com/moto-ogs/project-phoenix/modules/enrollment"
)

// staffPortal is the portal of the enrollment administration.
var staffPortal = []common.PortalScope{common.PortalTenant}

// PhaseRouteContracts registers the typed contract of the enrollment phase
// routes (ADR 0270), with patterns relative to /api/enrollment/phases.
func PhaseRouteContracts() []common.RouteContract {
	portals := staffPortal
	bumps := []common.QueryParam{{Name: "bumps_grade", Kind: common.QueryString}}
	return []common.RouteContract{
		{Method: "GET", Pattern: "/", Portals: portals, Response: []PhaseResponse{}},
		{Method: "POST", Pattern: "/", Portals: portals, Request: EnrollmentPhaseRequest{}, Response: PhaseResponse{}},
		{Method: "GET", Pattern: "/expiry-warnings", Portals: portals, Response: []PhaseExpiryWarningResponse{}},
		{Method: "GET", Pattern: "/{id}/", Portals: portals, Response: PhaseResponse{}},
		{Method: "PUT", Pattern: "/{id}/", Portals: portals, Request: EnrollmentPhaseRequest{}, Response: PhaseUpdateResponse{}},
		{Method: "DELETE", Pattern: "/{id}/", Portals: portals, NoData: true},
		{Method: "GET", Pattern: "/{id}/delete-impact", Portals: portals, Response: PhaseDeleteImpactResponse{}},
		{Method: "POST", Pattern: "/{id}/rollover", Portals: portals, Request: RolloverCreateRequest{}, Response: RolloverCreateResponse{}},
		{Method: "GET", Pattern: "/{id}/rollover-preview", Portals: portals, Query: bumps, Response: RolloverPreviewResponse{}},
		{Method: "GET", Pattern: "/{id}/review", Portals: portals, Response: []ReviewItemResponse{}},
		{Method: "GET", Pattern: "/{id}/responses", Portals: portals, Response: PhaseResponseOverviewResponse{}},
		{Method: "GET", Pattern: "/{id}/manual-bootstrap", Portals: portals, Response: PublicEnrollmentFormBootstrapResponse{}},
		{Method: "POST", Pattern: "/{id}/late-invites", Portals: portals, Request: AdminCreateLateInviteRequest{}, Response: AdminCreateLateInviteResponse{}},
		{Method: "POST", Pattern: "/{id}/manual-approved-enrollments", Portals: portals, Request: AdminManualApprovedEnrollmentRequest{}, Response: AdminManualApprovedEnrollmentResponse{}},
		{Method: "POST", Pattern: "/{id}/export", Portals: portals, File: true},
	}
}

// ConfigRouteContracts registers the form schemas, the legal documents and
// the care-offering catalog (#2352), relative to /api/enrollment.
func ConfigRouteContracts() []common.RouteContract {
	portals := staffPortal
	phase := []common.QueryParam{{Name: "phase_id", Kind: common.QueryID}}
	preview := []common.QueryParam{
		{Name: "phaseId", Kind: common.QueryID}, {Name: "schemaId", Kind: common.QueryID},
		{Name: "base", Kind: common.QueryString},
	}
	return []common.RouteContract{
		{Method: "GET", Pattern: "/schema/", Portals: portals, Response: FormSchemaResponse{}},
		// The bodies of POST and PUT carry the form's own fields and legal
		// blocks, the Enrollment types the answer carries; a type the
		// generator walks once as a request and once as a response it
		// refuses, so those bodies stay unregistered (#7563).
		{Method: "POST", Pattern: "/schema/", Portals: portals, Response: FormSchemaResponse{}},
		{Method: "GET", Pattern: "/schema/versions", Portals: portals, Response: []FormSchemaResponse{}},
		{Method: "GET", Pattern: "/schema/preview", Portals: portals, Query: preview, Response: SchemaPreviewBootstrapResponse{}},
		{Method: "GET", Pattern: "/schema/{id}", Portals: portals, Deprecated: true, Response: FormSchemaResponse{}},
		{Method: "PUT", Pattern: "/schema/{id}", Portals: portals, Response: FormSchemaResponse{}},
		{Method: "PATCH", Pattern: "/schema/{id}", Portals: portals, Request: RenameSchemaRequest{}, Response: FormSchemaResponse{}},
		{Method: "DELETE", Pattern: "/schema/{id}", Portals: portals, NoData: true},
		{Method: "DELETE", Pattern: "/legal-documents/{filename}", Portals: portals, NoData: true},
		{Method: "GET", Pattern: "/care-offerings/", Portals: portals, Query: phase, Response: []CareOfferingResponse{}},
		{Method: "POST", Pattern: "/care-offerings/", Portals: portals, Request: CareOfferingRequest{}, Response: CareOfferingResponse{}},
		{Method: "GET", Pattern: "/care-offerings/booking-stats", Portals: portals, Query: phase, Response: []CareOfferingBookingStatsResponse{}},
		{Method: "GET", Pattern: "/care-offerings/{id}/", Portals: portals, Deprecated: true, Response: CareOfferingResponse{}},
		{Method: "PUT", Pattern: "/care-offerings/{id}/", Portals: portals, Request: CareOfferingRequest{}, Response: CareOfferingResponse{}},
		{Method: "DELETE", Pattern: "/care-offerings/{id}/", Portals: portals, NoData: true},
		{Method: "POST", Pattern: "/care-offerings/{id}/clone", Portals: portals, Request: CloneCareOfferingRequest{}, Response: CareOfferingResponse{}},
	}
}

// AdminRequestRouteContracts registers the review of the requests (#2352),
// relative to /api/enrollment.
func AdminRequestRouteContracts() []common.RouteContract {
	portals := staffPortal
	list := []common.QueryParam{{Name: "phase_id", Kind: common.QueryID}, {Name: "child_status", Kind: common.QueryString}}
	return []common.RouteContract{
		{Method: "POST", Pattern: "/admin/request-children/{id}/rollover-review", Portals: portals, Request: RolloverReviewDecisionRequest{}, Response: RolloverReviewDecisionResponse{}},
		{Method: "GET", Pattern: "/admin/requests/", Portals: portals, Query: list, Response: []AdminRequestSummary{}},
		{Method: "GET", Pattern: "/admin/requests/unread-count", Portals: portals, Response: AdminUnreadRequestCountResponse{}},
		{Method: "POST", Pattern: "/admin/requests/mark-all-read", Portals: portals, NoData: true},
		{Method: "GET", Pattern: "/admin/requests/{id}/", Portals: portals, Response: AdminRequestDetail{}},
		{Method: "DELETE", Pattern: "/admin/requests/{id}/", Portals: portals, Request: AdminEnrollmentDeleteRequest{}, Response: AdminEnrollmentDeletionImpact{}},
		{Method: "GET", Pattern: "/admin/requests/{id}/form-labels", Portals: portals, Response: FormLabelsResponse{}},
		{Method: "GET", Pattern: "/admin/requests/{id}/signature-proof", Portals: portals, File: true},
		// One proof file of the request (#4783), through the portal's proxy (#2352).
		{Method: "GET", Pattern: "/admin/requests/{id}/uploads/{uploadId}", Portals: portals, File: true},
		{Method: "PUT", Pattern: "/admin/requests/{id}/read", Portals: portals, NoData: true},
		{Method: "DELETE", Pattern: "/admin/requests/{id}/read", Portals: portals, NoData: true},
		{Method: "GET", Pattern: "/admin/requests/{id}/delete-impact", Portals: portals, Response: AdminEnrollmentDeletionImpact{}},
		{Method: "GET", Pattern: "/admin/requests/{id}/mails", Portals: portals, Response: []capability.RequestMailOutcome{}},
		{Method: "POST", Pattern: "/admin/requests/{id}/restore", Portals: portals, Response: AdminRestoreResponse{}},
		{Method: "GET", Pattern: "/admin/requests/{id}/children/{childId}/delete-impact", Portals: portals, Response: AdminEnrollmentDeletionImpact{}},
		{Method: "DELETE", Pattern: "/admin/requests/{id}/children/{childId}", Portals: portals, Request: AdminEnrollmentDeleteRequest{}, Response: AdminEnrollmentDeletionImpact{}},
		{Method: "POST", Pattern: "/admin/requests/{id}/children/{childId}/decide", Portals: portals, Request: AdminDecideRequest{}, Response: AdminRequestChild{}},
		{Method: "PUT", Pattern: "/admin/requests/{id}/children/{childId}/data-correction", Portals: portals, Request: AdminChildDataCorrectionRequest{}, Response: ChangeRequestResponse{}},
		{Method: "PUT", Pattern: "/admin/requests/{id}/children/{childId}/offerings", Portals: portals, Request: AdminUpdateOfferingsRequest{}, Response: AdminChildOfferingsResponse{}},
		{Method: "GET", Pattern: "/admin/requests/{id}/children/{childId}/offering-adjustments", Portals: portals, Response: []AdminOfferingAdjustment{}},
		{Method: "GET", Pattern: "/admin/students/{studentId}/requests/", Portals: portals, Response: []AdminRequestSummary{}},
		{Method: "POST", Pattern: "/admin/students/{studentId}/requests/export", Portals: portals, File: true},
	}
}

// AdminReviewRouteContracts registers the change-request review and the care
// usage report (#2352), relative to /api/enrollment.
func AdminReviewRouteContracts() []common.RouteContract {
	portals := staffPortal
	changes := []common.QueryParam{{Name: "request_id", Kind: common.QueryID}, {Name: "status", Kind: common.QueryString}}
	reviewList := []common.QueryParam{
		{Name: "view", Kind: common.QueryString}, {Name: "search", Kind: common.QueryString},
		{Name: "status", Kind: common.QueryString}, {Name: "from", Kind: common.QueryDate}, {Name: "to", Kind: common.QueryDate},
		{Name: "cursor", Kind: common.QueryString}, {Name: "limit", Kind: common.QueryInt},
	}
	usage := []common.QueryParam{
		{Name: "phase_id", Kind: common.QueryID}, {Name: "status", Kind: common.QueryString},
		{Name: "care_offering_id", Kind: common.QueryID}, {Name: "care_offering_ids", Kind: common.QueryID, Repeated: true},
		{Name: "grade_level", Kind: common.QueryInt}, {Name: "day_count", Kind: common.QueryInt},
		{Name: "weekday", Kind: common.QueryString}, {Name: "pickup_time", Kind: common.QueryString},
		{Name: "search", Kind: common.QueryString},
	}
	return []common.RouteContract{
		{Method: "GET", Pattern: "/admin/change-requests/", Portals: portals, Query: changes, Response: []ChangeRequestResponse{}},
		{Method: "GET", Pattern: "/admin/change-requests/list", Portals: portals, Query: reviewList, Response: ChangeRequestReviewPage{}},
		{Method: "GET", Pattern: "/admin/change-requests/pending-count", Portals: portals, Response: EnrollmentChangeRequestPendingCountResponse{}},
		{Method: "GET", Pattern: "/admin/change-requests/{id}/", Portals: portals, Response: ChangeRequestResponse{}},
		{Method: "POST", Pattern: "/admin/change-requests/{id}/question", Portals: portals, Request: ChangeRequestMessageRequest{}, Response: ChangeRequestResponse{}},
		{Method: "POST", Pattern: "/admin/change-requests/{id}/approve", Portals: portals, Request: ReviewChangeRequestRequest{}, Response: ChangeRequestResponse{}},
		{Method: "POST", Pattern: "/admin/change-requests/{id}/reject", Portals: portals, Request: ReviewChangeRequestRequest{}, Response: ChangeRequestResponse{}},
		{Method: "GET", Pattern: "/admin/reports/care-usage", Portals: portals, Query: usage, Response: CareUsageReportResponse{}},
		{Method: "POST", Pattern: "/admin/reports/care-usage/export", Portals: portals, File: true},
		{Method: "POST", Pattern: "/admin/reports/class-roster/export", Portals: portals, File: true},
	}
}

// HolidayHostRouteContracts registers the holiday weeks a school hosts
// (#2352), relative to /api/holiday-weeks.
func HolidayHostRouteContracts() []common.RouteContract {
	portals := staffPortal
	return []common.RouteContract{
		{Method: "GET", Pattern: "/", Portals: portals, Response: []capability.HostedHolidayWeek{}},
		{Method: "GET", Pattern: "/home-school-children", Portals: portals, Response: []capability.HolidayHomeSchoolBooking{}},
		{Method: "GET", Pattern: "/students/{studentId}/health", Portals: portals, Response: []capability.HolidayStudentHealth{}},
		{Method: "GET", Pattern: "/students/{studentId}/registration", Portals: portals, Response: []capability.HolidayStudentRegistration{}},
		{Method: "GET", Pattern: "/{weekId}/own-children", Portals: portals, Response: []capability.HolidayOwnChildAssignment{}},
		{Method: "GET", Pattern: "/{weekId}/participants", Portals: portals, Response: HolidayParticipantListResponse{}},
		{Method: "GET", Pattern: "/{weekId}/participants/export", Portals: portals, File: true, Query: []common.QueryParam{
			{Name: "format", Kind: common.QueryString, Values: []string{string(lists.FormatCSV), string(lists.FormatXLSX)}},
		}},
		{Method: "PUT", Pattern: "/{weekId}/guest-group", Portals: portals, Request: HolidayGuestGroupRequest{}, Response: capability.HolidayGuestTransfer{}},
	}
}

// HolidayGuestRouteContracts registers the holiday guests of a school
// (#2352), relative to /api/holiday-guests.
func HolidayGuestRouteContracts() []common.RouteContract {
	portals := staffPortal
	return []common.RouteContract{
		{Method: "GET", Pattern: "/", Portals: portals, Response: []capability.HolidayGuestBadge{}},
		{Method: "GET", Pattern: "/groups", Portals: portals, Response: []capability.HolidayGuestGroup{}},
		{Method: "GET", Pattern: "/{studentId}", Portals: portals, Response: capability.HolidayGuestSheet{}},
	}
}
