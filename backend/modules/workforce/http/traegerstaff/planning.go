package traegerstaff

import (
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/render"

	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/modules/workforce"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// PlanningResource serves the Einsatzplanung of the session's Träger at
// /traeger/staff-planning (#4708, ADR 0242). Every route needs the Träger
// right „Personal“; the owner opens the transactions itself (ADR 0105).
type PlanningResource struct {
	planning     workforce.TraegerStaffPlanning
	requireStaff common.Middleware
}

// NewPlanningResource builds the resource; the root binds requireStaff to
// the Träger right traeger_staff:manage.
func NewPlanningResource(planning workforce.TraegerStaffPlanning, requireStaff common.Middleware) *PlanningResource {
	if planning == nil || requireStaff == nil {
		panic("workforce traeger planning: the planning and the right check are required")
	}
	return &PlanningResource{planning: planning, requireStaff: requireStaff}
}

// TraegerRouter returns the routes mounted at /traeger/staff-planning.
func (rs *PlanningResource) TraegerRouter(protectedTraegerRoutes func(chi.Router, func(chi.Router, common.Middleware))) chi.Router {
	r := chi.NewRouter()
	r.Use(render.SetContentType(render.ContentTypeJSON))
	protectedTraegerRoutes(r, func(r chi.Router, _ common.Middleware) {
		staff := r.With(rs.requireStaff)
		staff.Get("/", rs.week)
		staff.Get("/future-shifts", rs.futureShifts)
		staff.Post("/records/{id}/shifts", rs.plan)
		staff.Put("/records/{id}/shifts/{shiftId}", rs.change)
		staff.Delete("/records/{id}/schools/{schoolId}/shifts/{shiftId}", rs.remove)
	})
	return r
}

// planShiftRequest is one shift at one Einsatzort of the record.
type planShiftRequest struct {
	WorkingTimeConfirmed bool   `json:"working_time_confirmed"`
	WorkingTimeReason    string `json:"working_time_reason"`
	SchoolID             int64  `json:"school_id,string"`
	Date                 string `json:"date"`
	StartTime            string `json:"start_time"`
	EndTime              string `json:"end_time"`
	BreakMinutes         int    `json:"break_minutes"`
	Notes                string `json:"notes"`
}

func (req *planShiftRequest) Bind(*http.Request) error {
	if req.SchoolID <= 0 {
		return errors.New("school_id is required")
	}
	if _, err := calendar.ParseDate(req.Date); err != nil {
		return errors.New("date must be YYYY-MM-DD")
	}
	return nil
}

func (req *planShiftRequest) toInput(recordID int64) workforce.TraegerPlanShift {
	return workforce.TraegerPlanShift{
		RecordID: recordID, SchoolID: req.SchoolID, Date: calendar.Date(req.Date), StartTime: req.StartTime, EndTime: req.EndTime,
		BreakMinutes: req.BreakMinutes, Notes: req.Notes,
		WorkingTime: workforce.WorkingTimeConfirmation{Confirmed: req.WorkingTimeConfirmed, Reason: req.WorkingTimeReason},
	}
}

func (rs *PlanningResource) week(w http.ResponseWriter, r *http.Request) {
	session, ok := actor(w, r)
	if !ok {
		return
	}
	var weekStart calendar.Date
	if raw := r.URL.Query().Get("week"); raw != "" {
		parsed, err := calendar.ParseDate(raw)
		if err != nil {
			common.RenderError(w, r, common.ErrorInvalidRequest(errors.New("week must be YYYY-MM-DD")))
			return
		}
		weekStart = parsed
	}
	week, err := rs.planning.PlanningWeek(r.Context(), session, weekStart)
	if err != nil {
		renderPlanningError(w, r, err)
		return
	}
	common.Respond(w, r, http.StatusOK, week, "Planning week retrieved successfully")
}

func (rs *PlanningResource) futureShifts(w http.ResponseWriter, r *http.Request) {
	session, ok := actor(w, r)
	if !ok {
		return
	}
	schools, err := rs.planning.FutureShifts(r.Context(), session)
	if err != nil {
		renderPlanningError(w, r, err)
		return
	}
	common.Respond(w, r, http.StatusOK, schools, "Future shifts retrieved successfully")
}

func (rs *PlanningResource) plan(w http.ResponseWriter, r *http.Request) {
	session, recordID, ok := actorAndRecord(w, r)
	if !ok {
		return
	}
	var req planShiftRequest
	if err := render.Bind(r, &req); err != nil {
		common.RenderError(w, r, common.ErrorInvalidRequest(err))
		return
	}
	shift, err := rs.planning.PlanShift(r.Context(), session, req.toInput(recordID))
	if err != nil {
		renderPlanningError(w, r, err)
		return
	}
	common.Respond(w, r, http.StatusCreated, shift, "Shift planned successfully")
}

func (rs *PlanningResource) change(w http.ResponseWriter, r *http.Request) {
	session, recordID, ok := actorAndRecord(w, r)
	if !ok {
		return
	}
	shiftID, ok := common.ParseInt64IDWithError(w, r, "shiftId", "invalid shift ID")
	if !ok {
		return
	}
	var req planShiftRequest
	if err := render.Bind(r, &req); err != nil {
		common.RenderError(w, r, common.ErrorInvalidRequest(err))
		return
	}
	shift, err := rs.planning.ChangeShift(r.Context(), session, shiftID, req.toInput(recordID))
	if err != nil {
		renderPlanningError(w, r, err)
		return
	}
	common.Respond(w, r, http.StatusOK, shift, "Shift changed successfully")
}

func (rs *PlanningResource) remove(w http.ResponseWriter, r *http.Request) {
	session, recordID, ok := actorAndRecord(w, r)
	if !ok {
		return
	}
	shiftID, ok := common.ParseInt64IDWithError(w, r, "shiftId", "invalid shift ID")
	if !ok {
		return
	}
	schoolID, ok := common.ParseInt64IDWithError(w, r, "schoolId", "invalid school ID")
	if !ok {
		return
	}
	if err := rs.planning.RemoveShift(r.Context(), session, recordID, schoolID, shiftID); err != nil {
		renderPlanningError(w, r, err)
		return
	}
	common.Respond(w, r, http.StatusOK, nil, "Shift removed successfully")
}

// renderPlanningError maps the refusals of the Einsatzplanung onto their
// codes; the warnings of the working-time check travel in details.
func renderPlanningError(w http.ResponseWriter, r *http.Request, err error) {
	if details, ok := planCheckDetails(err); ok {
		code := common.CodeWorkforceShiftWorkingTimeWarning
		if errors.Is(err, workforce.ErrShiftOverlapsOtherSite) {
			code = common.CodeWorkforceShiftOverlapsOtherSite
		}
		common.RenderError(w, r, common.ErrorConflictWithDetails(err, code, details))
		return
	}
	common.RenderError(w, r, planningErrors(err))
}

var planningErrors = common.RulesRenderer([]common.ErrorRule{
	{Target: workforce.ErrTraegerStaffNotReleased, Render: coded(common.ErrorConflictWithCode, common.CodeWorkforceTraegerStaffNotReleased)},
	{Target: workforce.ErrTraegerStaffRecordNotFound, Render: coded(common.ErrorNotFoundWithCode, common.CodeWorkforceTraegerStaffRecordNotFound)},
	{Target: workforce.ErrTraegerPlanningSiteInvalid, Render: coded(common.ErrorInvalidRequestWithCode, common.CodeWorkforceTraegerPlanningSiteInvalid)},
	{Target: workforce.ErrTraegerPlanningShiftNotFound, Render: coded(common.ErrorNotFoundWithCode, common.CodeWorkforceTraegerPlanningShiftNotFound)},
	{Target: workforce.ErrShiftPlanningOff, Render: coded(common.ErrorConflictWithCode, common.CodeWorkforceShiftPlanningOff)},
	{Target: workforce.ErrStaffShiftOverlap, Render: coded(common.ErrorConflictWithCode, common.CodeWorkforceShiftOverlap)},
	{Target: workforce.ErrStaffShiftDuplicate, Render: coded(common.ErrorConflictWithCode, common.CodeWorkforceShiftDuplicate)},
	{Target: workforce.ErrStaffShiftConflict, Render: coded(common.ErrorConflictWithCode, common.CodeWorkforceShiftChanged)},
	{Target: workforce.ErrInvalidStaffShift, Render: common.ErrorInvalidRequest},
}, common.ErrorInternalServer)

// planCheckDetails returns the details{} of a refusal of the working-time
// check: the warnings and whether a reason is missing, or the shift at the
// other Einsatzort. ok is false for every other error.
func planCheckDetails(err error) (map[string]any, bool) {
	if warning, ok := errors.AsType[*workforce.ShiftWorkingTimeError](err); ok {
		return map[string]any{"warnings": warning.Warnings, "count": len(warning.Warnings), "reason_required": warning.ReasonRequired}, true
	}
	if other, ok := errors.AsType[*workforce.ShiftOtherSiteError](err); ok {
		details := map[string]any{"date": other.Date.String(), "day": other.Date.Format("02.01.2006"), "start": other.StartTime, "end": other.EndTime}
		if other.SchoolName != "" {
			details["school"] = other.SchoolName
		}
		return details, true
	}
	return nil, false
}
