package timetablehttp

import (
	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/modules/timetable"
)

// CancelInstanceRequest is the optional body of POST /instances/{id}/cancel
// (#1840, #2601).
type CancelInstanceRequest struct {
	Reason         *string                `json:"reason,omitempty"`
	GuardianNotice *GuardianNoticeRequest `json:"guardian_notice,omitempty"`
}

// ConflictAckResponse names the conflict a caller hid or showed again.
type ConflictAckResponse struct {
	Fingerprint string `json:"fingerprint"`
}

// SchoolVacationAcknowledgedResponse confirms a school vacation hint.
type SchoolVacationAcknowledgedResponse struct {
	Acknowledged bool `json:"acknowledged"`
}

// TemplateArchivedResponse names the template a delete archived.
type TemplateArchivedResponse struct {
	ID int64 `json:"id"`
}

// PlannedNowResponse lists the caller's blocks of the day.
type PlannedNowResponse struct {
	Instances []timetable.OperationPlannedInstance `json:"instances"`
}

var (
	idQuery   = common.QueryID
	dateQuery = common.QueryDate
)

// params joins query parameter lists into a fresh slice.
func params(lists ...[]common.QueryParam) []common.QueryParam {
	var out []common.QueryParam
	for _, list := range lists {
		out = append(out, list...)
	}
	return out
}

func query(kind common.QueryKind, names ...string) []common.QueryParam {
	out := make([]common.QueryParam, 0, len(names))
	for _, name := range names {
		out = append(out, common.QueryParam{Name: name, Kind: kind})
	}
	return out
}

// RouteContracts registers the typed contract of the staff portal's
// timetable (ADR 0270), with patterns relative to /api/timetable. The slot
// lists and the Betreuungsplan answer files and keep their route files.
func RouteContracts() []common.RouteContract {
	routes := calendarRouteContracts()
	routes = append(routes, instanceRouteContracts()...)
	routes = append(routes, planningRouteContracts()...)
	routes = append(routes, operationRouteContracts()...)
	routes = append(routes, templateRouteContracts()...)
	routes = append(routes, planningTrackRouteContracts()...)
	// The printable Betreuungsplan week answers a file (#2079, #2352).
	return append(routes, common.RouteContract{Method: "POST", Pattern: "/betreuungsplan/export", Portals: tenantPortal, File: true})
}

var tenantPortal = []common.PortalScope{common.PortalTenant}

func calendarRouteContracts() []common.RouteContract {
	p := tenantPortal
	window := query(dateQuery, "from", "to")
	return []common.RouteContract{
		{Method: "GET", Pattern: "/periods/", Portals: p, Response: []CalendarPeriodResponse{}},
		{Method: "POST", Pattern: "/periods/", Portals: p, Request: CalendarPeriodRequest{}, Response: CalendarPeriodResponse{}},
		{Method: "POST", Pattern: "/periods/bootstrap", Portals: p, Response: bootstrapPeriodsResponse{}},
		{Method: "GET", Pattern: "/periods/{id}", Portals: p, Response: CalendarPeriodResponse{}},
		{Method: "PUT", Pattern: "/periods/{id}", Portals: p, Request: CalendarPeriodRequest{}, Response: CalendarPeriodResponse{}},
		{Method: "DELETE", Pattern: "/periods/{id}", Portals: p, NoData: true},
		{Method: "GET", Pattern: "/closing-days/", Portals: p, Response: []ClosingDayResponse{}},
		{Method: "POST", Pattern: "/closing-days/", Portals: p, Request: ClosingDayRequest{}, Response: ClosingDayResponse{}},
		{Method: "PUT", Pattern: "/closing-days/{id}", Portals: p, Request: ClosingDayRequest{}, Response: ClosingDayResponse{}},
		{Method: "DELETE", Pattern: "/closing-days/{id}", Portals: p, NoData: true},
		{Method: "GET", Pattern: "/holidays", Portals: p, Query: window, Response: HolidaysResponse{}},
		{Method: "GET", Pattern: "/school-vacations", Portals: p, Query: window, Response: SchoolVacationsResponse{}},
		{Method: "GET", Pattern: "/school-vacation-hints", Portals: p, Response: SchoolVacationHintsResponse{}},
		{Method: "POST", Pattern: "/school-vacation-hints/acknowledgements", Portals: p, Request: schoolVacationAcknowledgementRequest{}, Response: SchoolVacationAcknowledgedResponse{}},
		{Method: "POST", Pattern: "/materialize", Portals: p, Request: materializeRequest{}, Response: materializeResponse{}},
	}
}

func instanceRouteContracts() []common.RouteContract {
	p := tenantPortal
	list := append(query(dateQuery, "from", "to"), query(idQuery, "group_id", "staff_id", "room_id")...)
	list = append(list, common.QueryParam{Name: "view", Kind: common.QueryString})
	edited := append(query(idQuery, "activity_group_id"), query(dateQuery, "from", "to")...)
	edited = append(edited, common.QueryParam{Name: "include_deletions", Kind: common.QueryBool})
	return []common.RouteContract{
		{Method: "GET", Pattern: "/instances/", Portals: p, Query: list, Response: weeklyInstancesResponse{}},
		{Method: "GET", Pattern: "/instances/edited-in-window", Portals: p, Query: edited, Response: editedInWindowResponse{}},
		{Method: "POST", Pattern: "/instances/", Portals: p, Request: createInstanceRequest{}, Response: enrichedInstance{}},
		{Method: "PUT", Pattern: "/instances/{id}", Portals: p, Request: updateInstanceRequest{}, Response: enrichedInstance{}},
		{Method: "DELETE", Pattern: "/instances/{id}", Portals: p, NoData: true},
		{Method: "POST", Pattern: "/instances/{id}/convert-to-series", Portals: p, Request: convertInstanceToSeriesRequest{}, Response: convertInstanceToSeriesResponse{}},
		{Method: "POST", Pattern: "/instances/re-plan-week", Portals: p, Request: replanWeekRequest{}, Response: replanWeekResponse{}},
		{Method: "POST", Pattern: "/instances/bulk-cancel", Portals: p, Request: bulkCancelRequest{}, Response: timetable.BulkCancelResult{}},
		{Method: "POST", Pattern: "/instances/{id}/start", Portals: p, Response: StartInstanceResponse{}},
		{Method: "POST", Pattern: "/instances/{id}/complete", Portals: p, Response: InstanceStatusResponse{}},
		{Method: "POST", Pattern: "/instances/{id}/reopen", Portals: p, Response: StartInstanceResponse{}},
		{Method: "POST", Pattern: "/instances/{id}/cancel", Portals: p, Request: CancelInstanceRequest{}, Response: InstanceStatusResponse{}},
		{Method: "POST", Pattern: "/instances/{id}/reinstate", Portals: p, Response: InstanceStatusResponse{}},
		{Method: "GET", Pattern: "/instances/{id}/guardian-notice", Portals: p, Response: GuardianNoticeReachResponse{}},
		{Method: "POST", Pattern: "/instances/{id}/deviations", Portals: p, Request: applyDeviationsRequest{}, Response: ApplyDeviationsResponse{}},
		{Method: "GET", Pattern: "/instances/{id}/staff-pool", Portals: p, Response: StaffPoolResponse{}},
		{Method: "GET", Pattern: "/instances/{id}/participants", Portals: p, Response: InstanceParticipantsResponse{}},
		{Method: "POST", Pattern: "/instances/{id}/move-staff", Portals: p, Request: moveStaffRequest{}, Response: MoveStaffResponse{}},
		{Method: "PATCH", Pattern: "/instances/{instance_id}/students/{student_id}", Portals: p, Request: PatchAttendanceRequest{}, Response: AttendanceResponse{}},
		{Method: "POST", Pattern: "/instances/{instance_id}/students/{student_id}/correction", Portals: p, Request: CorrectAttendanceRequest{}, Response: AttendanceResponse{}},
		{Method: "GET", Pattern: "/instances/{instance_id}/students/{student_id}/corrections", Portals: p, Response: attendanceCorrectionsResponse{}},
	}
}

func planningRouteContracts() []common.RouteContract {
	p := tenantPortal
	days := query(dateQuery, "date", "date_to")
	history := append(query(dateQuery, "date", "date_to"), query(idQuery, "activity_group_id")...)
	history = append(history, common.QueryParam{Name: "start_time", Kind: common.QueryString})
	conflicts := append(query(dateQuery, "date"), query(common.QueryString, "start_time", "end_time", "staff_ids", "student_ids")...)
	conflicts = append(conflicts, query(idQuery, "room_id", "exclude_instance_id", "exclude_activity_group_id")...)
	return []common.RouteContract{
		{Method: "GET", Pattern: "/student/{id}/day", Portals: p, Query: query(dateQuery, "date"), Response: StudentDayResponse{}},
		{Method: "GET", Pattern: "/student/{id}/week", Portals: p, Query: query(dateQuery, "from", "to"), Response: StudentWeekResponse{}},
		{Method: "GET", Pattern: "/gaps", Portals: p, Query: days, Response: GapsResponse{}},
		{Method: "POST", Pattern: "/substitutions/bulk", Portals: p, Request: bulkSubstitutionRequest{}, Response: BulkSubstitutionResponse{}},
		{Method: "GET", Pattern: "/deviations/history", Portals: p, Query: history, Response: DeviationHistoryResponse{}},
		{Method: "GET", Pattern: "/conflicts", Portals: p, Query: conflicts, Response: PlannedConflictsResponse{}},
		{Method: "GET", Pattern: "/pickup-extensions/", Portals: p, Query: query(idQuery, "student_id"), Response: pickupExtensionsResponse{}},
		{Method: "POST", Pattern: "/pickup-extensions/{id}/resolve", Portals: p, Request: resolvePickupExtensionRequest{}, Response: resolvePickupExtensionResponse{}},
		{Method: "GET", Pattern: "/conflict-acks/", Portals: p, Response: conflictAcksResponse{}},
		{Method: "PUT", Pattern: "/conflict-acks/{fingerprint}", Portals: p, Response: ConflictAckResponse{}},
		{Method: "DELETE", Pattern: "/conflict-acks/{fingerprint}", Portals: p, Response: ConflictAckResponse{}},
		{Method: "POST", Pattern: "/shift-coverage", Portals: p, Request: ShiftCoverageRequest{}, Response: ShiftCoverageResponse{}},
	}
}

func operationRouteContracts() []common.RouteContract {
	p := tenantPortal
	plannedNow := append(query(dateQuery, "date"), query(common.QueryInt, "horizon_minutes", "limit")...)
	plannedNow = append(plannedNow,
		common.QueryParam{Name: "scope", Kind: common.QueryString, Values: []string{timetable.PlannedNowScopePast, timetable.PlannedNowScopeDay}},
		common.QueryParam{Name: "include_roster", Kind: common.QueryBool})
	return []common.RouteContract{
		{Method: "GET", Pattern: "/operations/planned-now", Portals: p, Query: plannedNow, Response: PlannedNowResponse{}},
		{Method: "GET", Pattern: "/operations/instances/{id}/roster", Portals: p, Response: timetable.OperationRoster{}},
		{Method: "GET", Pattern: "/operations/active-groups/{id}/roster", Portals: p, Response: timetable.OperationRoster{}},
		{Method: "POST", Pattern: "/operations/spontaneous/start", Portals: p, Request: spontaneousStartRequest{}, Response: startOperationResponse{}},
		{Method: "POST", Pattern: "/operations/instances/{id}/start", Portals: p, Response: startOperationResponse{}},
		{Method: "POST", Pattern: "/operations/instances/{id}/complete", Portals: p, Request: CompleteOperationRequest{}, Response: timetable.ScheduledInstance{}},
		{Method: "POST", Pattern: "/operations/instances/{id}/reopen", Portals: p, Response: startOperationResponse{}},
		{Method: "POST", Pattern: "/operations/instances/{id}/students/{student_id}/check-in", Portals: p, Response: timetable.OperationRoster{}},
		{Method: "POST", Pattern: "/operations/instances/{id}/students/check-in", Portals: p, Request: bulkCheckInRequest{}, Response: timetable.OperationRoster{}},
		{Method: "POST", Pattern: "/operations/instances/{id}/students/{student_id}/check-out", Portals: p, Response: timetable.OperationRoster{}},
		{Method: "PATCH", Pattern: "/operations/instances/{id}/students/{student_id}/attendance", Portals: p, Request: PatchAttendanceRequest{}, Response: timetable.OperationRosterRow{}},
		{Method: "PUT", Pattern: "/operations/instances/{id}/students/{student_id}/homework-feedback", Portals: p, Request: HomeworkFeedbackRequest{}, Response: HomeworkFeedbackResponse{}},
	}
}

func templateRouteContracts() []common.RouteContract {
	p := tenantPortal
	period := query(idQuery, "period_id")
	filter := query(common.QueryString, "offering_ids", "grade_levels", "school_classes")
	draft := params(query(idQuery, "period_id"), []common.QueryParam{{Name: "roster", Kind: common.QueryString, Repeated: true}},
		query(common.QueryString, "list_kind", "type"))
	suggestion := params(draft, query(common.QueryString, "school_classes", "grade_levels", "end_time"))
	preview := params(draft, filter, query(dateQuery, "from"))
	return []common.RouteContract{
		{Method: "GET", Pattern: "/templates", Portals: p, Query: period, Response: listTemplatesResponse{}},
		{Method: "POST", Pattern: "/templates", Portals: p, Request: createTemplateRequest{}, Response: createTemplateResponse{}},
		{Method: "GET", Pattern: "/templates/{id}", Portals: p, Query: period, Response: templateResponse{}},
		{Method: "PUT", Pattern: "/templates/{id}", Portals: p, Request: updateTemplateRequest{}, Response: templateResponse{}},
		{Method: "DELETE", Pattern: "/templates/{id}", Portals: p, Response: TemplateArchivedResponse{}},
		{Method: "POST", Pattern: "/templates/{id}/split", Portals: p, Request: splitTemplateRequest{}, Response: splitTemplateResponse{}},
		{Method: "POST", Pattern: "/templates/{id}/end", Portals: p, Request: endTemplateRequest{}, Response: endTemplateResponse{}},
		{Method: "POST", Pattern: "/templates/{id}/students/{studentId}/remove-days", Portals: p, Request: removeStudentTemplateDaysRequest{}, Response: removeStudentTemplateDaysResponse{}},
		{Method: "PUT", Pattern: "/templates/{id}/students/{studentId}/kept-days", Portals: p, Request: keptStudentTemplateDaysRequest{}, Response: keptStudentTemplateDaysResponse{}},
		{Method: "GET", Pattern: "/templates/roster-deviations", Portals: p, Query: query(idQuery, "period_id", "template_id"), Response: rosterDeviationsResponse{}},
		{Method: "GET", Pattern: "/templates/{id}/offering-preview", Portals: p, Query: params(filter, query(dateQuery, "from")), Response: offeringPreviewResponse{}},
		{Method: "POST", Pattern: "/templates/{id}/offering-connection", Portals: p, Request: offeringConnectionRequest{}, Response: offeringConnectionResponse{}},
		{Method: "PUT", Pattern: "/templates/{id}/manual-roster", Portals: p, Request: manualRosterRequest{}, Response: manualRosterResponse{}},
		{Method: "GET", Pattern: "/templates/booking-leftovers", Portals: p, Query: period, Response: bookingLeftoversResponse{}},
		{Method: "GET", Pattern: "/offering-sources", Portals: p, Query: query(idQuery, "calendar_period_id"), Response: offeringSourcesResponse{}},
		{Method: "GET", Pattern: "/offering-sources/combined-counts", Portals: p, Query: params(query(common.QueryString, "ids"), query(idQuery, "calendar_period_id")), Response: combinedOfferingCountsResponse{}},
		{Method: "GET", Pattern: "/offering-sources/suggestion", Portals: p, Query: suggestion, Response: offeringSuggestionEnvelope{}},
		{Method: "GET", Pattern: "/offering-sources/preview", Portals: p, Query: preview, Response: offeringPreviewResponse{}},
		{Method: "GET", Pattern: "/offering-gaps", Portals: p, Query: period, Response: offeringGapsResponse{}},
		{Method: "PUT", Pattern: "/offering-gaps/{offeringId}/acknowledgement", Portals: p, Request: offeringGapAckRequest{}, Response: offeringGapAckResponse{}},
	}
}

func planningTrackRouteContracts() []common.RouteContract {
	p := tenantPortal
	return []common.RouteContract{
		{Method: "GET", Pattern: "/planning-tracks/", Portals: p, Response: []timetable.PlanningTrack{}},
		{Method: "POST", Pattern: "/planning-tracks/", Portals: p, Request: planningTrackRequest{}, Response: timetable.PlanningTrack{}},
		{Method: "PUT", Pattern: "/planning-tracks/order", Portals: p, Request: planningTrackOrderRequest{}, Response: []timetable.PlanningTrack{}},
		{Method: "PUT", Pattern: "/planning-tracks/{id}", Portals: p, Request: planningTrackRequest{}, Response: timetable.PlanningTrack{}},
		{Method: "DELETE", Pattern: "/planning-tracks/{id}", Portals: p, Response: timetable.PlanningTrack{}},
		{Method: "POST", Pattern: "/planning-tracks/{id}/restore", Portals: p, Response: timetable.PlanningTrack{}},
	}
}
