package timetablehttp

import (
	"errors"
	"net/http"

	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/modules/timetable"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

// Attendance is the same nameless, schedules:read projection as the full list.
// Display names remain behind the separate participants visibility check.
type instanceAttendanceResponse struct {
	InstanceID ident.ID                 `json:"instance_id"`
	Students   []instanceStudentSummary `json:"students"`
}

func (rs *Resource) getInstanceAttendance(w http.ResponseWriter, r *http.Request) {
	id, err := common.ParseID(r)
	if err != nil {
		common.RenderError(w, r, common.ErrorInvalidRequest(errors.New("invalid instance id")))
		return
	}
	if rs.TimetableData == nil {
		common.RenderError(w, r, common.ErrorInternalServer(errors.New("timetable resource not fully wired")))
		return
	}
	ctx := r.Context()
	inst, err := rs.TimetableData.FindScheduledInstance(ctx, id)
	if errors.Is(err, timetable.ErrActivityInstanceNotFound) {
		common.RenderError(w, r, common.ErrorNotFoundWithCode(errors.New("instance not found"), common.CodeTimetableInstanceNotFound))
		return
	}
	if err != nil {
		common.RenderError(w, r, common.ErrorInternalServerWrap("load instance failed", err))
		return
	}
	selected := []timetable.ScheduledInstance{inst}
	rows, err := rs.TimetableData.ListScheduledInstanceRows(ctx, selected, timetable.PlannerAttendance)
	if err != nil {
		common.RenderError(w, r, common.ErrorInternalServerWrap("load instance attendance failed", err))
		return
	}
	careDays, err := rs.resolveCareDays(ctx, selected, inst.Date, inst.Date)
	if err != nil {
		common.RenderError(w, r, common.ErrorInternalServerWrap("resolve instance care days failed", err))
		return
	}
	students := instanceAttendanceDetails(inst, rows.Participants[id], careDays, rows.Cutoffs[inst.Date])
	common.Respond(w, r, http.StatusOK, instanceAttendanceResponse{InstanceID: ident.ID(id), Students: students}, "Instance attendance retrieved")
}
