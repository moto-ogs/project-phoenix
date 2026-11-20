package timetracking

import (
	"time"

	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/modules/workforce"
)

// AdminSessionResponse is a work session as the admin session writes answer
// it, with the IDs as decimal strings.
type AdminSessionResponse struct {
	ID             common.ID  `json:"id"`
	TenantID       common.ID  `json:"tenant_id"`
	StaffID        common.ID  `json:"staff_id"`
	Date           string     `json:"date" contract:"date"`
	Status         string     `json:"status"`
	Source         string     `json:"source"`
	CheckInTime    time.Time  `json:"check_in_time"`
	CheckOutTime   *time.Time `json:"check_out_time,omitempty"`
	BreakMinutes   int        `json:"break_minutes"`
	Notes          string     `json:"notes,omitempty"`
	AutoCheckedOut bool       `json:"auto_checked_out"`
	CreatedBy      common.ID  `json:"created_by"`
	UpdatedBy      *common.ID `json:"updated_by,omitempty"`
	CreatedAt      time.Time  `json:"created_at"`
	UpdatedAt      time.Time  `json:"updated_at"`
}

func newAdminSessionResponse(session *workforce.WorkSession) AdminSessionResponse {
	response := AdminSessionResponse{
		ID: common.ID(session.ID), TenantID: common.ID(session.TenantID), StaffID: common.ID(session.StaffID),
		Date: session.Date, Status: session.Status, Source: session.Source,
		CheckInTime: session.CheckInTime, CheckOutTime: session.CheckOutTime, BreakMinutes: session.BreakMinutes,
		Notes: session.Notes, AutoCheckedOut: session.AutoCheckedOut, CreatedBy: common.ID(session.CreatedBy),
		CreatedAt: session.CreatedAt, UpdatedAt: session.UpdatedAt,
	}
	if session.UpdatedBy != nil {
		updatedBy := common.ID(*session.UpdatedBy)
		response.UpdatedBy = &updatedBy
	}
	return response
}

// ExportTransferResponse is the answer of an SFTP transfer: the JSON
// ExportTransferOutcome writes, with the file size as a count.
type ExportTransferResponse struct {
	Transferred     bool   `json:"transferred"`
	Filename        string `json:"filename"`
	ByteSize        int    `json:"byte_size"`
	TargetHost      string `json:"target_host,omitempty"`
	TargetDirectory string `json:"target_directory,omitempty"`
	Reason          string `json:"reason,omitempty"`
}

func newExportTransferResponse(outcome ExportTransferOutcome) ExportTransferResponse {
	return ExportTransferResponse{
		Transferred: outcome.Transferred, Filename: outcome.Filename, ByteSize: int(outcome.ByteSize),
		TargetHost: outcome.TargetHost, TargetDirectory: outcome.TargetDirectory, Reason: outcome.Reason,
	}
}

// PayrollNumberBody describes the body PayrollNumberRequest reads: a string,
// or null to clear the number.
type PayrollNumberBody struct {
	PersonnelNumber *string `json:"personnel_number"`
	Note            string  `json:"note"`
}

// RebookAbsencesBody describes the body workforce.RebookAbsencesRequest
// reads: the identifiers as JSON numbers or decimal strings.
type RebookAbsencesBody struct {
	AbsenceIDs    []common.JSONID `json:"absence_ids"`
	AbsenceType   string          `json:"absence_type"`
	AbsenceTypeID *common.JSONID  `json:"absence_type_id"`
	Reason        string          `json:"reason"`
	DryRun        bool            `json:"dry_run"`
}

// StaffAdminRouteContracts registers the typed contract of the workforce
// administration under /api/staff (ADR 0270), with patterns relative to
// that mount.
func StaffAdminRouteContracts() []common.RouteContract {
	portals := []common.PortalScope{common.PortalTenant}
	route := func(method, pattern string, request, response any, query ...common.QueryParam) common.RouteContract {
		return common.RouteContract{Method: method, Pattern: pattern, Portals: portals, Query: query, Request: request, Response: response, NoData: response == nil}
	}
	yearMonth := []common.QueryParam{{Name: "year", Kind: common.QueryInt}, {Name: "month", Kind: common.QueryInt}}
	routes := []common.RouteContract{
		route("GET", "/dashboard-summary", nil, workforce.DashboardSummary{}, common.QueryParam{Name: "period", Kind: common.QueryString}),
		route("GET", "/time-tracking/overview", nil, workforce.TimeTrackingOverview{},
			yearMonth[0], yearMonth[1],
			common.QueryParam{Name: "employment_type", Kind: common.QueryString},
			common.QueryParam{Name: "saldo_min", Kind: common.QueryInt},
			common.QueryParam{Name: "saldo_max", Kind: common.QueryInt},
			common.QueryParam{Name: "sort", Kind: common.QueryString},
			common.QueryParam{Name: "order", Kind: common.QueryString}),
		route("GET", "/time-tracking/target-coverage", nil, workforce.TargetCoverage{}, yearMonth...),
		route("GET", "/{id}/payroll-number", nil, PayrollNumberResponse{}),
		route("PUT", "/{id}/payroll-number", PayrollNumberBody{}, PayrollNumberResponse{}),
		route("GET", "/{id}/schedule", nil, ScheduleResponse{}),
		route("PUT", "/{id}/schedule", ScheduleUpdateRequest{}, ScheduleResponse{}),
		route("GET", "/{id}/time-tracking/month-summary", nil, workforce.MonthSummary{}, yearMonth...),
		// The daily table never asks for ?target_only=true, so the proxy
		// forwards the range only and the answer is always the projection.
		route("GET", "/{id}/time-tracking/schedule-targets", nil, []workforce.DailyProjection{},
			common.QueryParam{Name: "from", Kind: common.QueryDate}, common.QueryParam{Name: "to", Kind: common.QueryDate}),
		route("GET", "/{id}/time-tracking/comp-time-preview", nil, workforce.CompTimeBalancePreview{},
			common.QueryParam{Name: "date_start", Kind: common.QueryDate}, common.QueryParam{Name: "date_end", Kind: common.QueryDate},
			common.QueryParam{Name: "half_day", Kind: common.QueryBool}),
		route("POST", "/{id}/time-tracking/sessions", workforce.AdminCreateSessionRequest{}, AdminSessionResponse{}),
		route("PUT", "/{id}/time-tracking/sessions/{sessionId}", workforce.SessionUpdateRequest{}, AdminSessionResponse{}),
		route("GET", "/{id}/time-tracking/sessions/{sessionId}/edits", nil, []workforce.WorkSessionEditView{}),
		route("POST", "/{id}/absences/rebook", RebookAbsencesBody{}, workforce.AbsenceRebookingResult{}),
		route("DELETE", "/{id}/absences/{absenceId}", nil, nil),
		route("GET", "/absences/mails", nil, AbsenceDecisionMailsResponse{}, common.QueryParam{Name: "ids", Kind: common.QueryString}),
		route("DELETE", "/{id}/documents/{documentId}", nil, StammdatenAck{}),
		route("GET", "/{id}/documents", nil, StaffDocumentListResponse{}, common.QueryParam{Name: "category", Kind: common.QueryString}),
		{Method: "POST", Pattern: "/{id}/documents", Portals: portals, Multipart: true,
			MaxBodyBytes: maxStaffDocumentBody, TooLargeCode: common.CodeFilesFileTooLarge, Response: StaffDocumentResponse{}},
		{Method: "GET", Pattern: "/{id}/time-tracking/export", Portals: portals, File: true, Query: []common.QueryParam{
			{Name: "from", Kind: common.QueryDate}, {Name: "to", Kind: common.QueryDate},
			{Name: "format", Kind: common.QueryString, Values: []string{"csv", "pdf", "xlsx"}},
		}},
		// Files stream through the portal's proxy (#2352).
		{Method: "GET", Pattern: "/{id}/documents/{documentId}/download", Portals: portals, File: true},
	}
	routes = append(routes, staffAdminPersonnelContracts(route)...)
	routes = append(routes, staffAdminCrossStaffContracts(route)...)
	return routes
}

type contractRoute func(method, pattern string, request, response any, query ...common.QueryParam) common.RouteContract

// staffAdminPersonnelContracts registers the Stammdaten and the Nachweise.
func staffAdminPersonnelContracts(route contractRoute) []common.RouteContract {
	return []common.RouteContract{
		route("GET", "/{id}/stammdaten", nil, StammdatenResponse{}),
		route("PUT", "/{id}/stammdaten/person", StammdatenPersonRequest{}, StammdatenAck{}),
		route("PUT", "/{id}/stammdaten/kontakt", StammdatenKontaktRequest{}, StammdatenAck{}),
		route("PUT", "/{id}/stammdaten/arbeitsvertrag", StammdatenArbeitsvertragRequest{}, StammdatenAck{}),
		route("PUT", "/{id}/stammdaten/qualifikationen", StammdatenQualifikationenRequest{}, StammdatenAck{}),
		route("GET", "/{id}/stammdaten/bank-steuer", nil, StammdatenFinancialMaskedResponse{}),
		route("PUT", "/{id}/stammdaten/bank-steuer", StammdatenFinancialRequest{}, StammdatenAck{}),
		route("POST", "/{id}/stammdaten/bank-steuer/reveal", nil, StammdatenFinancialRevealResponse{}),
		route("GET", "/qualification-types", nil, []QualificationTypeResponse{}),
		route("POST", "/qualification-types", QualificationTypeRequest{}, QualificationTypeResponse{}),
		route("PUT", "/qualification-types/{typeId}", QualificationTypeRequest{}, QualificationTypeResponse{}),
		route("GET", "/qualifications", nil, []QualificationOverviewResponse{}),
		route("GET", "/{id}/qualifications", nil, []QualificationEntryResponse{}),
		route("GET", "/{id}/traeger-proofs", nil, []TraegerProofResponse{}),
		route("GET", "/me/qualifications", nil, []QualificationEntryResponse{}),
	}
}

// staffAdminCrossStaffContracts registers the school-wide feeds of /payroll
// and the time-tracking administration.
func staffAdminCrossStaffContracts(route contractRoute) []common.RouteContract {
	export := []common.QueryParam{
		{Name: "year", Kind: common.QueryInt}, {Name: "month", Kind: common.QueryInt},
		{Name: "granularity", Kind: common.QueryString}, {Name: "format", Kind: common.QueryString},
		{Name: "time_format", Kind: common.QueryString},
	}
	return []common.RouteContract{
		route("GET", "/time-tracking/audit-log", nil, workforce.AuditLogPage{},
			common.QueryParam{Name: "from", Kind: common.QueryDate}, common.QueryParam{Name: "to", Kind: common.QueryDate},
			common.QueryParam{Name: "staff_id", Kind: common.QueryID}, common.QueryParam{Name: "actor_id", Kind: common.QueryID},
			common.QueryParam{Name: "limit", Kind: common.QueryInt}, common.QueryParam{Name: "sources", Kind: common.QueryString},
			common.QueryParam{Name: "cursor", Kind: common.QueryString}),
		route("GET", "/time-tracking/export/datev-report", nil, workforce.DatevExportReport{}, export...),
		// The export file of the same query (#1417 2b), through the portal's proxy (#2352).
		{Method: "GET", Pattern: "/time-tracking/export", Portals: []common.PortalScope{common.PortalTenant}, Query: export, File: true},
		route("GET", "/time-tracking/export/sftp-status", nil, ExportTransferStatus{}),
		route("POST", "/time-tracking/export/sftp", TransferExportRequest{}, ExportTransferResponse{}),
		route("GET", "/time-tracking/payroll-dispatch", nil, workforce.PayrollDispatchOverview{}),
		route("GET", "/time-tracking/month-close/traeger-staff", nil, TraegerMonthStaff{},
			common.QueryParam{Name: "year", Kind: common.QueryInt}, common.QueryParam{Name: "month", Kind: common.QueryInt}),
		route("GET", "/time-tracking/payroll-rules", nil, PayrollRulesResponse{}),
		route("POST", "/time-tracking/payroll-rules/wage-types", PayrollWageTypeRequest{}, PayrollWageTypeResponse{}),
		route("PUT", "/time-tracking/payroll-rules/wage-types/{wageTypeId}", PayrollWageTypeRequest{}, PayrollWageTypeResponse{}),
		route("DELETE", "/time-tracking/payroll-rules/wage-types/{wageTypeId}", nil, nil),
		route("POST", "/time-tracking/payroll-rules/surcharge-rules", PayrollSurchargeRuleRequest{}, PayrollSurchargeRuleResponse{}),
		route("PUT", "/time-tracking/payroll-rules/surcharge-rules/{ruleId}", PayrollSurchargeRuleRequest{}, PayrollSurchargeRuleResponse{}),
		route("DELETE", "/time-tracking/payroll-rules/surcharge-rules/{ruleId}", nil, nil),
		route("PUT", "/time-tracking/payroll-rules/absence-types/{absenceTypeId}", PayrollAbsenceTypeRequest{}, nil),
	}
}
