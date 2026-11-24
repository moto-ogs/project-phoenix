package timetracking

import (
	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/modules/workforce"
)

// RouteContracts registers the typed contract of the staff member's own time
// tracking (ADR 0270), with patterns relative to /api/time-tracking. The
// planned shifts and the allowances are rendered by root-bound adapters, so
// the root names their row types.
func RouteContracts(shift, allowance any) []common.RouteContract {
	portals := []common.PortalScope{common.PortalTenant}
	param := func(kind common.QueryKind, names ...string) []common.QueryParam {
		out := make([]common.QueryParam, 0, len(names))
		for _, name := range names {
			out = append(out, common.QueryParam{Name: name, Kind: kind})
		}
		return out
	}
	days := param(common.QueryDate, "from", "to")
	year := param(common.QueryInt, "year")
	absences := append(param(common.QueryDate, "from", "to"), common.QueryParam{Name: "status", Kind: common.QueryString})
	session := SessionResponse{}
	absence := workforce.StaffAbsenceResponse{}
	readState := common.EnumContract{
		Name: "OwnTimeReadState", Fields: []string{"OwnTimeAssignments.state", "OwnLeaveMails.state"},
		Values: []string{workforce.OwnReadReady, workforce.OwnReadUnavailable},
	}
	return []common.RouteContract{
		{Method: "GET", Pattern: "/period", Portals: portals, Query: []common.QueryParam{
			{Name: "view", Kind: common.QueryString, Values: []string{workforce.OwnTimeWeek, workforce.OwnTimeMonth}},
			{Name: "start", Kind: common.QueryDate},
		}, Response: workforce.OwnTimePeriod{}, Enums: []common.EnumContract{
			{Name: "OwnTimePeriodView", Fields: []string{"OwnTimePeriod.view"}, Values: []string{workforce.OwnTimeWeek, workforce.OwnTimeMonth}},
			{Name: "OwnTimeShiftState", Fields: []string{"OwnTimeShifts.state", "OwnTimeMonthSummary.planned_shift_state"}, Values: []string{workforce.OwnReadReady, workforce.OwnReadNotBooked, workforce.OwnReadUnavailable}},
			readState,
		}},
		{Method: "GET", Pattern: "/overview", Portals: portals, Response: workforce.OwnClockOverview{}},
		{Method: "GET", Pattern: "/leave-overview", Portals: portals, Response: workforce.OwnLeaveOverview{}},
		{Method: "POST", Pattern: "/check-in", Portals: portals, Request: CheckInRequest{}, Response: session},
		{Method: "POST", Pattern: "/check-out", Portals: portals, Request: CheckOutRequest{}, Response: session},
		{Method: "GET", Pattern: "/current", Portals: portals, Response: &SessionResponse{}},
		{Method: "GET", Pattern: "/config", Portals: portals, Response: ConfigResponse{}},
		{Method: "GET", Pattern: "/holidays", Portals: portals, Query: days, Response: []workforce.PublicHoliday{}},
		{Method: "GET", Pattern: "/closing-days", Portals: portals, Query: days, Response: []closingDayRangeResponse{}},
		{Method: "GET", Pattern: "/history", Portals: portals, Query: days, Response: HistoryResponse{}},
		{Method: "PUT", Pattern: "/{id}", Portals: portals, Request: workforce.SessionUpdateRequest{}, Response: session},
		{Method: "GET", Pattern: "/{id}/edits", Portals: portals, Response: []workforce.WorkSessionEditView{}},
		{Method: "POST", Pattern: "/break/start", Portals: portals, Request: StartBreakRequest{}, Response: workforce.WorkSessionBreak{}},
		{Method: "POST", Pattern: "/break/end", Portals: portals, Response: session},
		{Method: "GET", Pattern: "/breaks/{sessionId}", Portals: portals, Response: []workforce.WorkSessionBreak{}},
		{Method: "GET", Pattern: "/shifts", Portals: portals, Query: days, Response: shift},
		{Method: "GET", Pattern: "/month-summary", Portals: portals, Query: param(common.QueryInt, "year", "month"), Response: workforce.MonthSummary{}},
		{Method: "GET", Pattern: "/schedule-targets", Portals: portals, Query: days, Response: []workforce.DailyProjection{}},
		{Method: "GET", Pattern: "/assignments", Portals: portals, Query: days, Response: []assignmentResponse{}},
		{Method: "GET", Pattern: "/absences", Portals: portals, Query: absences, Response: []workforce.StaffAbsenceResponse{}},
		{Method: "POST", Pattern: "/absences", Portals: portals, Request: OwnAbsenceRequest{}, Response: absence},
		{Method: "PUT", Pattern: "/absences/{id}", Portals: portals, Request: workforce.UpdateAbsenceRequest{}, Response: absence},
		{Method: "DELETE", Pattern: "/absences/{id}", Portals: portals, NoData: true},
		{Method: "POST", Pattern: "/absences/{id}/cancel", Portals: portals, NoData: true},
		{Method: "POST", Pattern: "/absences/{id}/resubmit", Portals: portals, Request: ResubmitAbsenceRequest{}, Response: &workforce.StaffAbsenceResponse{}},
		{Method: "GET", Pattern: "/absences/mails", Portals: portals, Response: AbsenceRequestMailsResponse{}},
		{Method: "POST", Pattern: "/vacation/request", Portals: portals, Request: workforce.RequestVacationRequest{}, Response: absence},
		{Method: "GET", Pattern: "/vacation/quota", Portals: portals, Query: year, Response: workforce.VacationQuotaSummary{}},
		{Method: "GET", Pattern: "/absence-allowances", Portals: portals, Query: year, Response: allowance},
	}
}
