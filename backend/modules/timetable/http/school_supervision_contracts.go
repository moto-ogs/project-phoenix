package timetablehttp

import (
	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/modules/timetable"
)

// SchoolSupervisionsResponse lists the caller's own blocks of today.
type SchoolSupervisionsResponse struct {
	Instances []timetable.OperationPlannedInstance `json:"instances"`
}

// CompleteOperationRequest names the children the supervisor confirmed as
// present when she ends a block.
type CompleteOperationRequest struct {
	ConfirmedPresentStudentIDs []int64 `json:"confirmed_present_student_ids"`
}

// SchoolSupervisionRouteContracts registers the typed contract of the
// supervisions in moto schule (ADR 0270), with patterns relative to
// /school/supervisions. sheet is the answer type of the child sheet, which
// Class Day owns.
func SchoolSupervisionRouteContracts(sheet any) []common.RouteContract {
	portals := []common.PortalScope{common.PortalSchool}
	return []common.RouteContract{
		{Method: "GET", Pattern: "/", Portals: portals, Response: SchoolSupervisionsResponse{}},
		{Method: "GET", Pattern: "/{id}/roster", Portals: portals, Response: timetable.OperationRoster{}},
		{Method: "GET", Pattern: "/{id}/students/{student_id}/sheet", Portals: portals, Response: sheet},
		{Method: "POST", Pattern: "/{id}/start", Portals: portals, Response: startOperationResponse{}},
		{Method: "POST", Pattern: "/{id}/complete", Portals: portals, Request: CompleteOperationRequest{}, Response: timetable.ScheduledInstance{}},
		{Method: "POST", Pattern: "/{id}/students/{student_id}/check-in", Portals: portals, Response: timetable.OperationRoster{}},
		{Method: "POST", Pattern: "/{id}/students/{student_id}/check-out", Portals: portals, Response: timetable.OperationRoster{}},
		{Method: "PATCH", Pattern: "/{id}/students/{student_id}/attendance", Portals: portals, Request: PatchAttendanceRequest{}, Response: timetable.OperationRosterRow{}},
		{Method: "PUT", Pattern: "/{id}/students/{student_id}/homework-feedback", Portals: portals, Request: HomeworkFeedbackRequest{}, Response: HomeworkFeedbackResponse{}},
	}
}
