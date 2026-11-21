package staffcalendarhttp

import (
	"context"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/render"

	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/modules/schoolcalendar/traegercalendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// TraegerClosingDayResource serves the closing days of a Träger in the
// Träger-Portal (#4702) at /traeger/closing-days. Every route sits behind the
// Träger session and runs in the Träger transaction of the session's Träger
// (ADR 0105); the Träger comes from the session, never from the request.
// Reading needs the right "Übersicht sehen"; planning needs the right
// "Einstellungen verwalten", because a closing day takes the Soll of every
// named school's staff.
type TraegerClosingDayResource struct {
	days          traegercalendar.ClosingDays
	lists         common.ListRenderer
	requireRead   common.Middleware
	requireManage common.Middleware
	staffing      StaffingChangeQueue
}

// StaffingChangeQueue wakes a school's staff pages after the surrounding
// transaction commits. The composition root binds it to the shared
// staffing_deviation_changed queue.
type StaffingChangeQueue interface {
	QueueStaffingChanged(ctx context.Context, tenantID int64, source string)
}

const closingDayChangeSource = "closing_days"

// NewTraegerClosingDayResource builds the resource; the root binds the right
// checks to the rights Identity & Access bundles into the Träger roles;
// lists renders the closing days as PDF, Excel or CSV (#4718).
func NewTraegerClosingDayResource(days traegercalendar.ClosingDays, lists common.ListRenderer, requireRead, requireManage common.Middleware, staffing StaffingChangeQueue) *TraegerClosingDayResource {
	if days == nil || lists == nil || requireRead == nil || requireManage == nil {
		panic("school calendar http: the Träger closing days, the list renderer and the right checks are required")
	}
	return &TraegerClosingDayResource{days: days, lists: lists, requireRead: requireRead, requireManage: requireManage, staffing: staffing}
}

// TraegerRouter returns the routes mounted at /traeger/closing-days.
func (rs *TraegerClosingDayResource) TraegerRouter(protectedTraegerRoutes func(chi.Router, func(chi.Router, common.Middleware))) chi.Router {
	r := chi.NewRouter()
	r.Use(render.SetContentType(render.ContentTypeJSON))
	protectedTraegerRoutes(r, func(r chi.Router, withTx common.Middleware) {
		r.With(rs.requireRead, withTx).Get("/", rs.calendar)
		r.With(rs.requireRead, withTx).Get("/export", rs.export)
		manage := r.With(rs.requireManage, withTx)
		manage.Post("/", rs.create)
		manage.Put("/{id}", rs.update)
		manage.Delete("/{id}", rs.delete)
	})
	return r
}

// TraegerClosingDayRequest is the body of POST /traeger/closing-days and PUT
// /traeger/closing-days/{id}.
type TraegerClosingDayRequest struct {
	StartDate calendar.Date `json:"start_date"`
	EndDate   calendar.Date `json:"end_date"`
	Reason    string        `json:"reason"`
	SchoolIDs []int64       `json:"school_ids"`
	// HolidayBookingsToken confirms the preview of the affected holiday
	// bookings (#6434), empty when the preview showed none.
	HolidayBookingsToken string `json:"holiday_bookings_token"`
}

// Bind accepts the body; the Owner validates the closing day.
func (req *TraegerClosingDayRequest) Bind(*http.Request) error { return nil }

func (req *TraegerClosingDayRequest) input() traegercalendar.ClosingDayInput {
	return traegercalendar.ClosingDayInput{StartDate: req.StartDate, EndDate: req.EndDate, Reason: req.Reason, SchoolIDs: req.SchoolIDs, HolidayBookingsToken: req.HolidayBookingsToken}
}

func traegerOf(w http.ResponseWriter, r *http.Request) (int64, bool) {
	principal, err := common.CurrentPrincipal(r.Context())
	if err != nil || principal.OrganizationID() <= 0 {
		common.RenderError(w, r, common.ErrorUnauthorized(common.ErrUnauthorized))
		return 0, false
	}
	return principal.OrganizationID(), true
}

// calendar answers GET /traeger/closing-days?from=YYYY-MM-DD&to=YYYY-MM-DD.
func (rs *TraegerClosingDayResource) calendar(w http.ResponseWriter, r *http.Request) {
	organizationID, ok := traegerOf(w, r)
	if !ok {
		return
	}
	result, _, _, ok := rs.readCalendar(w, r, organizationID)
	if !ok {
		return
	}
	common.Respond(w, r, http.StatusOK, result, "Träger calendar retrieved successfully")
}

// readCalendar reads the calendar of the window from= to= of the request;
// ok is false once the refusal is rendered.
func (rs *TraegerClosingDayResource) readCalendar(w http.ResponseWriter, r *http.Request, organizationID int64) (traegercalendar.Calendar, calendar.Date, calendar.Date, bool) {
	from, fromErr := calendar.ParseDate(r.URL.Query().Get("from"))
	to, toErr := calendar.ParseDate(r.URL.Query().Get("to"))
	if fromErr != nil || toErr != nil {
		common.RenderError(w, r, common.ErrorInvalidRequestWithCode(errors.Join(fromErr, toErr), common.CodeTraegerClosingDayInvalid))
		return traegercalendar.Calendar{}, from, to, false
	}
	result, err := rs.days.Calendar(r.Context(), organizationID, from, to)
	if err != nil {
		renderTraegerClosingDayError(w, r, err)
		return traegercalendar.Calendar{}, from, to, false
	}
	return result, from, to, true
}

func (rs *TraegerClosingDayResource) create(w http.ResponseWriter, r *http.Request) {
	organizationID, ok := traegerOf(w, r)
	if !ok {
		return
	}
	req := &TraegerClosingDayRequest{}
	if err := render.Bind(r, req); err != nil {
		common.RenderError(w, r, common.ErrorInvalidRequestWithCode(err, common.CodeTraegerClosingDayInvalid))
		return
	}
	day, err := rs.days.CreateClosingDay(r.Context(), organizationID, req.input())
	if err != nil {
		renderTraegerClosingDayError(w, r, err)
		return
	}
	rs.announceClosingDayChange(r.Context(), day.AffectedSchoolIDs)
	common.Respond(w, r, http.StatusCreated, day, "Träger closing day created successfully")
}

func (rs *TraegerClosingDayResource) update(w http.ResponseWriter, r *http.Request) {
	organizationID, ok := traegerOf(w, r)
	if !ok {
		return
	}
	id, err := common.ParseID(r)
	if err != nil {
		common.RenderError(w, r, common.ErrorNotFoundWithCode(traegercalendar.ErrClosingDayNotFound, common.CodeTraegerClosingDayNotFound))
		return
	}
	req := &TraegerClosingDayRequest{}
	if err := render.Bind(r, req); err != nil {
		common.RenderError(w, r, common.ErrorInvalidRequestWithCode(err, common.CodeTraegerClosingDayInvalid))
		return
	}
	day, err := rs.days.UpdateClosingDay(r.Context(), organizationID, id, req.input())
	if err != nil {
		renderTraegerClosingDayError(w, r, err)
		return
	}
	rs.announceClosingDayChange(r.Context(), day.AffectedSchoolIDs)
	common.Respond(w, r, http.StatusOK, day, "Träger closing day updated successfully")
}

func (rs *TraegerClosingDayResource) delete(w http.ResponseWriter, r *http.Request) {
	organizationID, ok := traegerOf(w, r)
	if !ok {
		return
	}
	id, err := common.ParseID(r)
	if err != nil {
		common.RenderError(w, r, common.ErrorNotFoundWithCode(traegercalendar.ErrClosingDayNotFound, common.CodeTraegerClosingDayNotFound))
		return
	}
	day, err := rs.days.DeleteClosingDay(r.Context(), organizationID, id, r.URL.Query().Get("holiday_bookings_token"))
	if err != nil {
		renderTraegerClosingDayError(w, r, err)
		return
	}
	rs.announceClosingDayChange(r.Context(), day.AffectedSchoolIDs)
	common.Respond(w, r, http.StatusOK, TraegerClosingDayDeleted{NotifiedFamilies: day.NotifiedFamilies}, "Träger closing day deleted successfully")
}

// announceClosingDayChange wakes exactly the school pages that can display a
// changed Träger closing day. The Träger request has no school in its context,
// so the saved operation supplies the affected school IDs. The injected queue
// waits for the surrounding transaction to commit; an earlier wake could
// refetch a rolled-back value.
func (rs *TraegerClosingDayResource) announceClosingDayChange(ctx context.Context, schoolIDs []int64) {
	if rs.staffing == nil || len(schoolIDs) == 0 {
		return
	}
	for _, schoolID := range schoolIDs {
		rs.staffing.QueueStaffingChanged(ctx, schoolID, closingDayChangeSource)
	}
}

// TraegerClosingDayDeleted is the answer of DELETE: the families told that
// their days open again (#6457).
type TraegerClosingDayDeleted struct {
	NotifiedFamilies int `json:"notified_families"`
}

// renderTraegerClosingDayError names a refusal. The Owner refuses before it
// writes, or the Träger transaction rolls the write back (#6434).
func renderTraegerClosingDayError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, traegercalendar.ErrClosingDayNotFound):
		common.RenderError(w, r, common.ErrorNotFoundWithCode(err, common.CodeTraegerClosingDayNotFound))
	case errors.Is(err, traegercalendar.ErrSchoolOutside):
		common.RenderError(w, r, common.ErrorInvalidOnField(err, common.CodeTraegerClosingDaySchoolOutside, "school_ids"))
	case errors.Is(err, traegercalendar.ErrHolidayBookingsChanged):
		common.RenderError(w, r, common.ErrorConflictWithCode(err, common.CodeTraegerClosingDayBookingsChanged))
	case errors.Is(err, traegercalendar.ErrInvalidClosingDay):
		common.RenderError(w, r, common.ErrorInvalidRequestWithCode(err, common.CodeTraegerClosingDayInvalid))
	default:
		common.RenderError(w, r, common.ErrorInternalServer(err))
	}
}
