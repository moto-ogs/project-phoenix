package classdayhttp

import (
	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/modules/classday"
)

// RouteContracts registers the typed contract of the class day in moto
// schule (ADR 0270), with patterns relative to /school/class-day. The export
// of the absence list answers a file and keeps its route file.
func RouteContracts() []common.RouteContract {
	portals := []common.PortalScope{common.PortalSchool}
	class := common.QueryParam{Name: "class", Kind: common.QueryString}
	date := common.QueryParam{Name: "date", Kind: common.QueryDate}
	from := common.QueryParam{Name: "from", Kind: common.QueryDate}
	to := common.QueryParam{Name: "to", Kind: common.QueryDate}
	return []common.RouteContract{
		{Method: "GET", Pattern: "/classes", Portals: portals, Response: ClassesResponse{}},
		{Method: "GET", Pattern: "/", Portals: portals, Query: []common.QueryParam{class, date}, Response: classday.DayReport{}},
		{Method: "GET", Pattern: "/school-day", Portals: portals, Query: []common.QueryParam{date}, Response: classday.SchoolDayReport{}},
		{Method: "GET", Pattern: "/absence-list", Portals: portals, Query: []common.QueryParam{class, from, to}, Response: classday.AbsenceListReport{}},
		{Method: "GET", Pattern: "/shared-notes/{schoolClass}/students/{studentId}", Portals: portals, Response: classday.StudentSharedNotes{}},
		{Method: "GET", Pattern: "/arrival-exceptions", Portals: portals, Query: []common.QueryParam{class, from, to}, Response: ArrivalExceptionListResponse{}},
		{Method: "GET", Pattern: "/arrival-exceptions/block-start", Portals: portals, Query: []common.QueryParam{class, date}, Response: ArrivalExceptionBlockStartResponse{}},
		{Method: "PUT", Pattern: "/arrival-exceptions/{schoolClass}/{date}", Portals: portals, Request: ArrivalExceptionRequest{}, Response: ArrivalExceptionResponse{}},
		{Method: "DELETE", Pattern: "/arrival-exceptions/{schoolClass}/{date}", Portals: portals, NoData: true},
		{Method: "POST", Pattern: "/class-trips/{schoolClass}", Portals: portals, Request: ClassTripRequest{}, Response: classday.ClassTripResult{}},
		{Method: "PUT", Pattern: "/day-hints/{schoolClass}/{date}", Portals: portals, Request: DayHintRequest{}, NoData: true},
		{Method: "DELETE", Pattern: "/day-hints/{schoolClass}/{date}", Portals: portals, NoData: true},
		{Method: "PUT", Pattern: "/day-hints/{schoolClass}/{date}/students/{studentId}", Portals: portals, Request: DayHintRequest{}, NoData: true},
		{Method: "DELETE", Pattern: "/day-hints/{schoolClass}/{date}/students/{studentId}", Portals: portals, NoData: true},
		{Method: "PUT", Pattern: "/morning-attendance/{schoolClass}/{date}", Portals: portals, Request: MorningAttendanceRequest{}, NoData: true},
		{Method: "POST", Pattern: "/homework/{schoolClass}", Portals: portals, Request: HomeworkRequest{}, Response: classday.DayHomework{}},
		{Method: "PUT", Pattern: "/homework/{schoolClass}/{homeworkId}", Portals: portals, Request: HomeworkRequest{}, Response: classday.DayHomework{}},
		{Method: "DELETE", Pattern: "/homework/{schoolClass}/{homeworkId}", Portals: portals, NoData: true},
		{Method: "PUT", Pattern: "/handover/{schoolClass}/{date}", Portals: portals, Request: ClassHandoverRequest{}, NoData: true},
		{Method: "DELETE", Pattern: "/handover/{schoolClass}/{date}", Portals: portals, NoData: true},
		{Method: "PUT", Pattern: "/absence-reports/{schoolClass}/{date}/students/{studentId}", Portals: portals, Request: AbsenceReportRequest{}, NoData: true},
		{Method: "DELETE", Pattern: "/absence-reports/{schoolClass}/{date}/students/{studentId}", Portals: portals, NoData: true},
	}
}

// SlotListRouteContracts registers the typed contract of the slot lists'
// options and preview (ADR 0270), with patterns relative to /api/timetable.
// The export answers a file and keeps its route file.
func SlotListRouteContracts() []common.RouteContract {
	portals := []common.PortalScope{common.PortalTenant}
	return []common.RouteContract{
		{Method: "POST", Pattern: "/lists/options", Portals: portals, Request: slotListOptionsRequest{}, Response: classday.OptionsResult{}},
		{Method: "POST", Pattern: "/lists/preview", Portals: portals, Request: slotListRequest{}, Response: classday.ClassdayResult{}},
		{Method: "POST", Pattern: "/lists/export", Portals: portals, Request: slotListRequest{}, File: true},
	}
}
