package timetablehttp

import (
	"errors"
	"net/http"
	"time"

	"github.com/go-chi/render"
	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess/sessiontoken"
	"github.com/moto-ogs/project-phoenix/modules/timetable"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

type updateInstanceRequest struct {
	Date            string     `json:"date"`
	StartTime       string     `json:"start_time"`
	EndTime         string     `json:"end_time"`
	Title           string     `json:"title"`
	Description     *string    `json:"description,omitempty"`
	Notes           *string    `json:"notes,omitempty"`
	RoomID          ident.ID   `json:"room_id"`
	ActivityGroupID *ident.ID  `json:"activity_group_id,omitempty"`
	ListKind        *string    `json:"list_kind,omitempty"`
	StaffIDs        []ident.ID `json:"staff_ids,omitempty"`
	StudentIDs      []ident.ID `json:"student_ids,omitempty"`
	// RequiredStaff is the optional per-occurrence Personalbedarf pin (#1839);
	// omitted/null clears the pin (inherit the template override, else derive
	// from the Betreuungsschlüssel), a value = pin for this occurrence.
	RequiredStaff *int `json:"required_staff,omitempty"`
	// ExpectedVersion is the block's version its editor read (ADR 0311).
	ExpectedVersion string `json:"expected_version"`
}

func (req *updateInstanceRequest) Bind(_ *http.Request) error {
	if req.Date == "" {
		return errors.New("date is required (YYYY-MM-DD)")
	}
	invalid := common.CodeTimetableInstanceInvalid
	if req.Title == "" {
		return invalidField(invalid, "title", "title is required")
	}
	if len(req.Title) > 255 {
		return invalidField(invalid, "title", "title cannot exceed 255 characters")
	}
	if req.StartTime == "" || req.EndTime == "" {
		return invalidField(invalid, "start_time", "start_time and end_time are required")
	}
	// 0 = no room: only an occurrence of a duty may omit it (#3822); the
	// service checks the linked template. Without a template it is required.
	if req.RoomID < 0 || (req.RoomID == 0 && req.ActivityGroupID == nil) {
		return invalidField(invalid, "room_id", "room_id is required")
	}
	return nil
}

func (rs *Resource) updateInstance(w http.ResponseWriter, r *http.Request) {
	id, err := common.ParseID(r)
	if err != nil {
		common.RenderError(w, r, common.ErrorInvalidRequest(errors.New("invalid instance id")))
		return
	}
	if rs.InstanceService == nil || rs.TimetableData == nil {
		common.RenderError(w, r, common.ErrorInternalServer(errors.New("timetable resource not fully wired")))
		return
	}
	req := &updateInstanceRequest{}
	if err := render.Bind(r, req); err != nil {
		common.RenderError(w, r, bindErrorRenderer(err))
		return
	}
	date, startTime, endTime, ok := parseUpdatedInstanceSlot(w, r, req)
	if !ok {
		return
	}
	listKind, err := normalizeInstanceListKind(req.ListKind)
	if err != nil {
		common.RenderError(w, r, common.ErrorInvalidRequest(err))
		return
	}

	inst, err := rs.InstanceService.UpdatePlanned(r.Context(), id, timetable.UpdateInstanceInput{
		Date:            date,
		StartTime:       startTime,
		EndTime:         endTime,
		Title:           req.Title,
		Description:     req.Description,
		Notes:           req.Notes,
		RoomID:          req.RoomID.Int64(),
		ActivityGroupID: (*int64)(req.ActivityGroupID),
		ListKind:        listKind,
		StaffIDs:        ident.Int64s(req.StaffIDs),
		StudentIDs:      ident.Int64s(req.StudentIDs),
		RequiredStaff:   normalizeRequiredStaff(req.RequiredStaff),
		ExpectedVersion: req.ExpectedVersion,
	}, sessiontoken.ActorAccountIDFromCtx(r.Context()))
	if err != nil {
		renderInstanceLifecycleError(w, r, err)
		return
	}
	// A failed care-day derivation fails the response rather than answering with
	// counts that read every assigned child as expected again (#1747 review) —
	// the same 500 the rest of the enrichment already returns here.
	enriched, err := rs.enrichWrittenInstance(r.Context(), inst.ID)
	if err != nil {
		common.RenderError(w, r, common.ErrorInternalServerWrap("enrich instance failed", err))
		return
	}
	common.Respond(w, r, http.StatusOK, enriched, "Instance updated")
}

// parseUpdatedInstanceSlot reads the block's new date and clock window. It
// returns ok=false after rendering the 400 for a malformed value or a window
// that does not end after it starts.
func parseUpdatedInstanceSlot(w http.ResponseWriter, r *http.Request, req *updateInstanceRequest) (date calendar.Date, startTime, endTime time.Time, ok bool) {
	date, err := berlinDate(req.Date)
	if err != nil {
		common.RenderError(w, r, common.ErrorInvalidRequest(errors.New("invalid date format, expected YYYY-MM-DD")))
		return date, startTime, endTime, false
	}
	startTime, err = parseClockTime(req.StartTime)
	if err != nil {
		common.RenderError(w, r, common.ErrorInvalidRequest(errors.New("invalid start_time format, expected HH:MM")))
		return date, startTime, endTime, false
	}
	endTime, err = parseClockTime(req.EndTime)
	if err != nil {
		common.RenderError(w, r, common.ErrorInvalidRequest(errors.New("invalid end_time format, expected HH:MM")))
		return date, startTime, endTime, false
	}
	if !endTime.After(startTime) {
		common.RenderError(w, r, invalidOnField(common.CodeTimetableInstanceEndBeforeStart, "end_time", "end_time must be after start_time"))
		return date, startTime, endTime, false
	}
	return date, startTime, endTime, true
}
