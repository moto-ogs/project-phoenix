package staffcalendarhttp

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/moto-ogs/project-phoenix/api/common"
	calendarService "github.com/moto-ogs/project-phoenix/modules/schoolcalendar/portal"
	timezone "github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// mountSchoolParentConferences mounts the Elternsprechtag of moto schule
// (#4801) under /school/calendar/parent-conferences. The Lehrkraft offers a
// day for a class she teaches, sees its occupancy and prints it.
func (rs *Resource) mountSchoolParentConferences(r chi.Router, school, withTx common.Middleware) {
	r.With(school, withTx).Get("/parent-conferences", rs.listSchoolParentConferences)
	r.With(school, withTx).Post("/parent-conferences", rs.createSchoolParentConference)
	r.With(school, withTx).Get("/parent-conferences/{conferenceId}", rs.getSchoolParentConference)
	r.With(school, withTx).Put("/parent-conferences/{conferenceId}", rs.updateSchoolParentConference)
	r.With(school, withTx).Delete("/parent-conferences/{conferenceId}", rs.deleteSchoolParentConference)
}

// ParentConferenceRequest is the body of an Elternsprechtag. The contract
// keeps request and answer types apart, so the breaks have a type of their
// own here.
type ParentConferenceRequest struct {
	SchoolClass string                  `json:"school_class"`
	Date        timezone.Date           `json:"date"`
	StartTime   string                  `json:"start_time"`
	EndTime     string                  `json:"end_time"`
	SlotMinutes int                     `json:"slot_minutes"`
	Breaks      []ParentConferenceBreak `json:"breaks"`
	Location    *string                 `json:"location,omitempty"`
}

// ParentConferenceBreak is a pause without slots.
type ParentConferenceBreak struct {
	StartTime string `json:"start_time"`
	EndTime   string `json:"end_time"`
}

func decodeParentConference(w http.ResponseWriter, r *http.Request) (calendarService.ParentConferenceRequest, bool) {
	var req ParentConferenceRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		common.RenderError(w, r, common.ErrorInvalidRequest(err))
		return calendarService.ParentConferenceRequest{}, false
	}
	var breaks []calendarService.ParentConferenceWindow
	if req.Breaks != nil {
		breaks = make([]calendarService.ParentConferenceWindow, 0, len(req.Breaks))
		for _, pause := range req.Breaks {
			breaks = append(breaks, calendarService.ParentConferenceWindow(pause))
		}
	}
	return calendarService.ParentConferenceRequest{
		SchoolClass: req.SchoolClass, Date: req.Date, StartTime: req.StartTime, EndTime: req.EndTime,
		SlotMinutes: req.SlotMinutes, Breaks: breaks, Location: req.Location,
	}, true
}

func (rs *Resource) listSchoolParentConferences(w http.ResponseWriter, r *http.Request) {
	list, err := rs.service.ListSchoolParentConferences(r.Context())
	if err != nil {
		renderCalendarError(w, r, err)
		return
	}
	common.Respond(w, r, http.StatusOK, list, "Parent conferences retrieved")
}

func (rs *Resource) getSchoolParentConference(w http.ResponseWriter, r *http.Request) {
	id, ok := common.ParsePositiveInt64IDWithError(w, r, "conferenceId", "invalid parent conference ID")
	if !ok {
		return
	}
	view, err := rs.service.GetSchoolParentConference(r.Context(), id)
	if err != nil {
		renderCalendarError(w, r, err)
		return
	}
	common.Respond(w, r, http.StatusOK, view, "Parent conference retrieved")
}

func (rs *Resource) createSchoolParentConference(w http.ResponseWriter, r *http.Request) {
	req, ok := decodeParentConference(w, r)
	if !ok {
		return
	}
	view, err := rs.service.CreateSchoolParentConference(r.Context(), req)
	if err != nil {
		renderCalendarError(w, r, err)
		return
	}
	common.Respond(w, r, http.StatusCreated, view, "Parent conference created")
}

func (rs *Resource) updateSchoolParentConference(w http.ResponseWriter, r *http.Request) {
	id, ok := common.ParsePositiveInt64IDWithError(w, r, "conferenceId", "invalid parent conference ID")
	if !ok {
		return
	}
	req, ok := decodeParentConference(w, r)
	if !ok {
		return
	}
	view, err := rs.service.UpdateSchoolParentConference(r.Context(), id, req)
	if err != nil {
		renderCalendarError(w, r, err)
		return
	}
	common.Respond(w, r, http.StatusOK, view, "Parent conference updated")
}

func (rs *Resource) deleteSchoolParentConference(w http.ResponseWriter, r *http.Request) {
	id, ok := common.ParsePositiveInt64IDWithError(w, r, "conferenceId", "invalid parent conference ID")
	if !ok {
		return
	}
	if err := rs.service.DeleteSchoolParentConference(r.Context(), id); err != nil {
		renderCalendarError(w, r, err)
		return
	}
	common.Respond(w, r, http.StatusOK, CalendarStatusResponse{Status: "deleted"}, "Parent conference deleted")
}
