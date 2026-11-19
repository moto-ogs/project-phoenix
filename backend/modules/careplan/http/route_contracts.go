package careplanhttp

import (
	"github.com/moto-ogs/project-phoenix/api/common"
	careplan "github.com/moto-ogs/project-phoenix/modules/careplan"
)

// studentDocumentDeletedResponse names the child whose document was removed.
type studentDocumentDeletedResponse struct {
	StudentID int64 `json:"student_id"`
}

// DecisionResponses are the answer types of the review routes. Request
// Review renders them (the root binds WriteCareDecision and its siblings),
// so the root names them.
type DecisionResponses struct {
	CareDecision, CareDetail, MasterDataDecision, ExcusedDecision any
}

// StudentRouteContracts registers the typed contract of Care Plan's student
// routes besides the create and update (ADR 0270), with patterns relative to
// /api/students. Uploads and downloads keep their own BFF routes.
func StudentRouteContracts(decisions DecisionResponses) []common.RouteContract {
	routes := reviewRouteContracts(decisions)
	routes = append(routes, careExitRouteContracts()...)
	routes = append(routes, pickupRouteContracts()...)
	return append(routes, arrivalRouteContracts()...)
}

func reviewRouteContracts(decisions DecisionResponses) []common.RouteContract {
	portals := []common.PortalScope{common.PortalTenant}
	return []common.RouteContract{
		{Method: "POST", Pattern: "/{id}/accident-reports", Portals: portals, Request: AccidentReportRequest{}, Response: StudentDocumentResponse{}},
		{Method: "PUT", Pattern: "/{id}/accident-reports/{documentId}", Portals: portals, Request: AccidentReportRequest{}, Response: StudentDocumentResponse{}},
		{Method: "POST", Pattern: "/{id}/accident-reports/{documentId}/corrections", Portals: portals, Request: AccidentReportRequest{}, Response: StudentDocumentResponse{}},
		{Method: "POST", Pattern: "/{id}/accident-reports/{documentId}/signature", Portals: portals, Request: AccidentSignatureRequest{}, Response: StudentDocumentResponse{}},
		{Method: "DELETE", Pattern: "/{id}/documents/{documentId}", Portals: portals, Response: studentDocumentDeletedResponse{}},
		{Method: "POST", Pattern: "/master-data-change-requests/{requestId}/decide", Portals: portals, Request: DecideMasterDataChangeRequestBody{}, Response: decisions.MasterDataDecision},
		{Method: "POST", Pattern: "/care-schedule-change-requests/{requestId}/decide", Portals: portals, Request: DecideCareRequestBody{}, Response: decisions.CareDecision},
		{Method: "GET", Pattern: "/care-schedule-change-requests/{requestId}", Portals: portals, Response: decisions.CareDetail},
		{Method: "POST", Pattern: "/offering-change-requests/{requestId}/preview", Portals: portals, Request: PreviewOfferingRequestBody{}, Response: OfferingRequestPreviewResponse{}},
		{Method: "POST", Pattern: "/offering-change-requests/{requestId}/decide", Portals: portals, Request: DecideOfferingRequestBody{}, Response: offeringDecisionResponse{}},
		// The AG waiting lists left their reshaping route file in #7563.
		{
			Method: "GET", Pattern: "/offering-change-requests/course-waitlists", Portals: portals,
			Query:    []common.QueryParam{{Name: "activity_group_id", Kind: common.QueryID}},
			Response: []CourseWaitlistResponse{},
		},
		{Method: "POST", Pattern: "/excused-absence-requests/{requestId}/decide", Portals: portals, Request: DecideExcusedRequestBody{}, Response: decisions.ExcusedDecision},
		{Method: "POST", Pattern: "/change-requests/bulk-approve", Portals: portals, Request: bulkApproveParentRequestsBody{}, Response: parentRequestsApprovedResponse{}},
		{Method: "POST", Pattern: "/change-requests/conflicts/resolve", Portals: portals, Request: resolveConflictBody{}, Response: parentRequestConflictResolvedResponse{}},
		{Method: "POST", Pattern: "/change-requests/{kind}/{requestId}/mark-done", Portals: portals, Request: markRequestDoneBody{}, Response: parentRequestDoneResponse{}},
		{Method: "POST", Pattern: "/change-requests/{kind}/{requestId}/correct", Portals: portals, Request: correctRequestBody{}, Response: parentRequestCorrectedResponse{}},
	}
}

func careExitRouteContracts() []common.RouteContract {
	portals := []common.PortalScope{common.PortalTenant}
	page := []common.QueryParam{{Name: "page", Kind: common.QueryInt}, {Name: "page_size", Kind: common.QueryInt}}
	withdrawals := append([]common.QueryParam{
		{Name: "search", Kind: common.QueryString}, {Name: "student_id", Kind: common.QueryID},
		{Name: "state", Kind: common.QueryString, Values: []string{careplan.WithdrawalStatePending, careplan.WithdrawalStateResolved}},
	}, page...)
	ended := append([]common.QueryParam{
		{Name: "search", Kind: common.QueryString}, {Name: "school_class", Kind: common.QueryString, Repeated: true},
	}, page...)
	return []common.RouteContract{
		{Method: "POST", Pattern: "/care-end/preview", Portals: portals, Request: careExitRequest{}, Response: careExitPreviewResponse{}},
		{Method: "POST", Pattern: "/care-end", Portals: portals, Request: careExitRequest{}, Response: careExitConfirmedResponse{}},
		{Method: "POST", Pattern: "/care-end/cancel", Portals: portals, Request: careExitCancelRequest{}, Response: careExitCancelledResponse{}},
		{Method: "GET", Pattern: "/care-withdrawals", Portals: portals, Query: withdrawals, Response: careWithdrawalPageResponse{}},
		{Method: "GET", Pattern: "/{id}/care-withdrawals", Portals: portals, Query: page, Response: careWithdrawalPageResponse{}},
		{Method: "POST", Pattern: "/care-withdrawals/{completionId}/care-end/preview", Portals: portals, Request: careWithdrawalExitRequest{}, Response: careExitPreviewResponse{}},
		{Method: "POST", Pattern: "/care-withdrawals/{completionId}/care-end", Portals: portals, Request: careWithdrawalExitRequest{}, Response: careExitConfirmedResponse{}},
		{Method: "POST", Pattern: "/{id}/care-end/resume", Portals: portals, Request: careResumeRequest{}, Response: careResumedResponse{}},
		{Method: "GET", Pattern: "/ended-care", Portals: portals, Query: ended, Response: endedCarePageResponse{}},
		{Method: "GET", Pattern: "/{id}/companions", Portals: portals, Response: []CompanionResponse{}},
	}
}

func pickupRouteContracts() []common.RouteContract {
	portals := []common.PortalScope{common.PortalTenant}
	days := []common.QueryParam{{Name: "from", Kind: common.QueryDate}, {Name: "to", Kind: common.QueryDate}}
	return []common.RouteContract{
		{Method: "GET", Pattern: "/{id}/pickup-schedules", Portals: portals, Query: days, Response: PickupDataResponse{}},
		{Method: "PUT", Pattern: "/{id}/pickup-schedules", Portals: portals, Request: BulkPickupScheduleRequest{}, Response: PickupDataResponse{}},
		{Method: "POST", Pattern: "/{id}/pickup-schedules/preview", Portals: portals, Request: pickupAdjustmentRequest{}, Response: pickupAdjustmentPreviewResponse{}},
		{Method: "POST", Pattern: "/{id}/pickup-schedules/apply", Portals: portals, Request: pickupAdjustmentRequest{}, Response: pickupAdjustmentResponse{}},
		{Method: "POST", Pattern: "/{id}/pickup-schedules/reset-offering", Portals: portals, Request: ResetOfferingPickupRequest{}, Response: PickupDataResponse{}},
		{Method: "POST", Pattern: "/pickup-schedules/bulk", Portals: portals, Request: BulkPickupSchedulePatchRequest{}, Response: careplan.BulkUpsertResult{}},
		{Method: "POST", Pattern: "/{id}/pickup-exceptions", Portals: portals, Request: PickupExceptionRequest{}, Response: PickupExceptionResponse{}},
		{Method: "PUT", Pattern: "/{id}/pickup-exceptions/{exceptionId}", Portals: portals, Request: PickupExceptionRequest{}, Response: PickupExceptionResponse{}},
		{Method: "DELETE", Pattern: "/{id}/pickup-exceptions/{exceptionId}", Portals: portals, NoData: true},
		{Method: "PUT", Pattern: "/{id}/departure-exceptions/{date}", Portals: portals, Request: DepartureExceptionRequest{}, Response: DepartureExceptionResponse{}},
		{Method: "DELETE", Pattern: "/{id}/departure-exceptions/{date}", Portals: portals, NoData: true},
		{Method: "GET", Pattern: "/{id}/partial-absences", Portals: portals, Query: days, Response: []PartialAbsenceResponse{}},
		{Method: "POST", Pattern: "/{id}/partial-absences", Portals: portals, Request: PartialAbsenceRequest{}, Response: PartialAbsenceResponse{}},
		{Method: "PUT", Pattern: "/{id}/partial-absences/{partialAbsenceId}", Portals: portals, Request: PartialAbsenceRequest{}, Response: PartialAbsenceResponse{}},
		{Method: "DELETE", Pattern: "/{id}/partial-absences/{partialAbsenceId}", Portals: portals, Response: partialAbsenceDeletedResponse{}},
		{Method: "POST", Pattern: "/{id}/pickup-notes", Portals: portals, Request: PickupNoteRequest{}, Response: PickupNoteResponse{}},
		{Method: "PUT", Pattern: "/{id}/pickup-notes", Portals: portals, Request: WeekdayPickupNotesRequest{}, NoData: true},
		{Method: "PUT", Pattern: "/{id}/pickup-notes/{noteId}", Portals: portals, Request: PickupNoteRequest{}, Response: PickupNoteResponse{}},
		{Method: "DELETE", Pattern: "/{id}/pickup-notes/{noteId}", Portals: portals, NoData: true},
		{Method: "GET", Pattern: "/pickup-change-notices", Portals: portals, Response: []pickupChangeNoticeResponse{}},
		{Method: "POST", Pattern: "/{id}/pickup-change-notices/read", Portals: portals, Request: pickupChangeNoticesReadRequest{}, Response: []pickupChangeNoticeResponse{}},
	}
}

func arrivalRouteContracts() []common.RouteContract {
	portals := []common.PortalScope{common.PortalTenant}
	return []common.RouteContract{
		{Method: "GET", Pattern: "/arrival-settings", Portals: portals, Response: arrivalSettingsResponse{}},
		{
			Method: "GET", Pattern: "/{id}/arrival-schedules", Portals: portals,
			Query:    []common.QueryParam{{Name: "date", Kind: common.QueryDate}, {Name: "to", Kind: common.QueryDate}},
			Response: ArrivalDataResponse{},
		},
		{Method: "PUT", Pattern: "/{id}/arrival-schedules", Portals: portals, Request: BulkArrivalScheduleRequest{}, Response: ArrivalDataResponse{}},
		{Method: "POST", Pattern: "/{id}/arrival-exceptions", Portals: portals, Request: StudentArrivalExceptionRequest{}, Response: StudentArrivalExceptionResponse{}},
		{Method: "PUT", Pattern: "/{id}/arrival-exceptions/{exceptionId}", Portals: portals, Request: StudentArrivalExceptionRequest{}, Response: StudentArrivalExceptionResponse{}},
		{Method: "DELETE", Pattern: "/{id}/arrival-exceptions/{exceptionId}", Portals: portals, NoData: true},
		{Method: "POST", Pattern: "/{id}/arrival-notes", Portals: portals, Request: ArrivalNoteRequest{}, Response: ArrivalNoteResponse{}},
		{Method: "PUT", Pattern: "/{id}/arrival-notes/{noteId}", Portals: portals, Request: ArrivalNoteRequest{}, Response: ArrivalNoteResponse{}},
		{Method: "DELETE", Pattern: "/{id}/arrival-notes/{noteId}", Portals: portals, NoData: true},
		{Method: "POST", Pattern: "/arrival-schedules/bulk", Portals: portals, Request: BulkUpsertArrivalScheduleRequest{}, Response: careplan.BulkUpsertResult{}},
		{Method: "POST", Pattern: "/arrival-schedules/status", Portals: portals, Request: BulkEffectiveTimeRequest{}, Response: ArrivalScheduleStatusResponse{}},
		{Method: "GET", Pattern: "/class-arrival-times/{schoolClass}", Portals: portals, Response: ClassArrivalTimesResponse{}},
		{
			Method: "GET", Pattern: "/class-arrival-exceptions/{schoolClass}", Portals: portals,
			Query:    []common.QueryParam{{Name: "from", Kind: common.QueryDate}, {Name: "to", Kind: common.QueryDate}},
			Response: ClassArrivalExceptionListResponse{},
		},
		{Method: "PUT", Pattern: "/class-arrival-exceptions/{schoolClass}/{date}", Portals: portals, Request: ClassArrivalExceptionRequest{}, Response: ClassArrivalExceptionResponse{}},
		{Method: "DELETE", Pattern: "/class-arrival-exceptions/{schoolClass}/{date}", Portals: portals, NoData: true},
	}
}
