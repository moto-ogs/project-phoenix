package timetracking

import (
	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/modules/workforce"
)

// VacationQuotaRequest is the body of PUT /api/staff/{id}/vacation/quota; a
// missing year stands for the current one.
type VacationQuotaRequest struct {
	Year          int     `json:"year"`
	EntitledDays  float64 `json:"entitled_days"`
	CarryoverDays float64 `json:"carryover_days"`
	Reason        string  `json:"reason"`
	// ExpectedVersion is the version of the summary the form showed; a claim
	// changed since is refused with general.changed_since_read (ADR 0311).
	ExpectedVersion string `json:"expected_version"`
}

// StaffAdminWorkflowRouteContracts registers the absence decisions, the
// balance and vacation corrections, the Sonderarbeitszeiten and the
// Monatsabschluss under /api/staff (#2352), with patterns relative to that
// mount.
func StaffAdminWorkflowRouteContracts() []common.RouteContract {
	portals := []common.PortalScope{common.PortalTenant}
	route := func(method, pattern string, request, response any, query ...common.QueryParam) common.RouteContract {
		return common.RouteContract{Method: method, Pattern: pattern, Portals: portals, Query: query, Request: request, Response: response, NoData: response == nil}
	}
	days := []common.QueryParam{{Name: "from", Kind: common.QueryDate}, {Name: "to", Kind: common.QueryDate}}
	year := common.QueryParam{Name: "year", Kind: common.QueryInt}
	absence := workforce.StaffAbsenceResponse{}
	adjustment := workforce.StaffBalanceAdjustment{}
	decision := workforce.VacationDecisionRequest{}
	// A registered pointer to a list (&[]T{}): the handler answers null when
	// the capability finds no row, as these routes always did.
	routes := []common.RouteContract{
		route("GET", "/absences/pending", nil, &[]workforce.StaffAbsenceResponse{}),
		route("GET", "/absences/requests", nil, []absenceRequestResponse{},
			common.QueryParam{Name: "view", Kind: common.QueryString}, common.QueryParam{Name: "search", Kind: common.QueryString},
			common.QueryParam{Name: "types", Kind: common.QueryString}),
		route("POST", "/absences/{absenceId}/approve", decision, absence),
		route("POST", "/absences/{absenceId}/deny", decision, absence),
		route("POST", "/absences/{absenceId}/question", decision, absence),
		route("GET", "/absences/plan-gaps", nil, []workforce.AbsencePlanGap{}),
		route("POST", "/absences/{absenceId}/plan-sync", nil, absencePlanSyncResponse{}),
		route("GET", "/{id}/absences", nil, &[]workforce.StaffAbsenceResponse{}, days...),
		route("POST", "/{id}/absences", workforce.CreateAbsenceRequest{}, absence),
		route("GET", "/{id}/vacation/quota", nil, workforce.VacationQuotaSummary{}, year),
		route("PUT", "/{id}/vacation/quota", VacationQuotaRequest{}, workforce.VacationQuotaSummary{}),
		route("POST", "/{id}/vacation/opening", setVacationOpeningRequest{}, workforce.StaffVacationOpening{}),
		route("DELETE", "/{id}/vacation/opening", nil, nil, year),
		route("GET", "/{id}/time-tracking/history", nil, HistoryResponse{}, days...),
		route("GET", "/{id}/time-tracking/adjustments", nil, &[]workforce.StaffBalanceAdjustment{}, days...),
		route("POST", "/{id}/time-tracking/adjustments", createBalanceAdjustmentRequest{}, adjustment),
		route("DELETE", "/{id}/time-tracking/adjustments/{adjustmentId}", nil, nil),
		route("POST", "/{id}/time-tracking/reset", resetBalanceRequest{}, adjustment),
		route("POST", "/{id}/time-tracking/opening", openingBalanceRequest{}, adjustment),
		route("GET", "/{id}/target-overrides", nil, []workforce.StaffTargetOverride{}),
		route("POST", "/{id}/target-overrides", targetOverrideRequest{}, workforce.StaffTargetOverride{}),
		route("DELETE", "/{id}/target-overrides/{overrideId}", nil, nil),
		route("GET", "/time-tracking/month-close", nil, &[]workforce.StaffMonthBalanceSnapshot{},
			common.QueryParam{Name: "year", Kind: common.QueryInt}, common.QueryParam{Name: "month", Kind: common.QueryInt}),
		route("POST", "/time-tracking/month-close", monthCloseRequest{}, workforce.MonthCloseResult{}),
		route("POST", "/{id}/time-tracking/month-close/reopen", monthCloseRequest{}, nil),
	}
	return routes
}
