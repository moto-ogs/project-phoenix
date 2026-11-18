package timetracking

import (
	"errors"
	"net/http"

	"github.com/moto-ogs/project-phoenix/modules/workforce"

	"github.com/go-chi/render"
	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/tenant"
)

// monthCloseErrorRules classifies the remaining Monatsabschluss sentinel
// (#1417): caller mistakes → 400. The sentinels the frontend has to
// distinguish carry machine-readable codes in renderMonthCloseError before
// this table is consulted.
var monthCloseErrorRules = []common.ErrorRule{
	{Target: workforce.ErrMonthCloseInvalid, Render: common.ErrorInvalidRequest},
}

func renderMonthCloseError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, workforce.ErrLaterMonthClosed):
		common.RenderError(w, r, common.ErrorConflictWithCode(err, common.CodeWorkforceLaterMonthClosed))
	case errors.Is(err, workforce.ErrMonthNotClosable):
		common.RenderError(w, r, common.ErrorInvalidRequestWithCode(err, common.CodeWorkforceMonthNotClosable))
	case errors.Is(err, workforce.ErrMonthNotClosed):
		common.RenderError(w, r, common.ErrorNotFoundWithCode(err, common.CodeWorkforceMonthNotClosed))
	case errors.Is(err, workforce.ErrMonthClosedByTraeger):
		common.RenderError(w, r, common.ErrorConflictWithCode(err, common.CodeWorkforceMonthClosedByTraeger))
	default:
		common.RenderError(w, r, common.RenderWithRules(err, monthCloseErrorRules, common.ErrorInternalServer))
	}
}

// monthCloseRequest is the wire shape for POST
// /api/staff/time-tracking/month-close and the per-staff reopen. The reason is
// mandatory: freezing and unfreezing a Stundenkonto are both decisions that
// have to be attributable.
type monthCloseRequest struct {
	Year   int    `json:"year"`
	Month  int    `json:"month"`
	Reason string `json:"reason"`
}

// listMonthCloseStatus handles GET /api/staff/time-tracking/month-close?year=&month=
func (rs *StaffAdminResource) listMonthCloseStatus(w http.ResponseWriter, r *http.Request) {
	year, month, err := ParseYearMonthQuery(r)
	if err != nil {
		common.RenderError(w, r, common.ErrorInvalidRequest(err))
		return
	}
	snapshots, err := rs.MonthCloseService.ListMonthStatus(r.Context(), year, month)
	if err != nil {
		renderMonthCloseError(w, r, err)
		return
	}
	common.Respond(w, r, http.StatusOK, snapshots, "Month close status retrieved")
}

// listTraegerMonthStaff handles GET
// /api/staff/time-tracking/month-close/traeger-staff?year=&month=: the staff
// members the Träger closes because a contract of the Träger covers the
// month (#4711). The school's close leaves them out.
func (rs *StaffAdminResource) listTraegerMonthStaff(w http.ResponseWriter, r *http.Request) {
	year, month, err := ParseYearMonthQuery(r)
	if err != nil {
		common.RenderError(w, r, common.ErrorInvalidRequest(err))
		return
	}
	staffIDs, err := rs.MonthCloseService.TraegerMonthStaff(r.Context(), year, month)
	if err != nil {
		renderMonthCloseError(w, r, err)
		return
	}
	common.Respond(w, r, http.StatusOK, TraegerMonthStaff{Year: year, Month: month, StaffIDs: staffIDs}, "Traeger month staff retrieved")
}

// TraegerMonthStaff lists the staff members the Träger closes in a month.
type TraegerMonthStaff struct {
	Year     int     `json:"year"`
	Month    int     `json:"month"`
	StaffIDs []int64 `json:"staff_ids"`
}

// closeMonth handles POST /api/staff/time-tracking/month-close — freezes the
// month for the whole school. The ambient tenant transaction wraps the entire
// loop, so one failing staff member rolls the close back completely.
func (rs *StaffAdminResource) closeMonth(w http.ResponseWriter, r *http.Request) {
	closedBy, err := rs.resolveEditorStaffID(r.Context())
	if err != nil {
		common.RenderError(w, r, ownStaffError(err))
		return
	}
	var req monthCloseRequest
	if err := render.DecodeJSON(r.Body, &req); err != nil {
		common.RenderError(w, r, common.ErrorInvalidRequest(err))
		return
	}
	result, err := rs.MonthCloseService.CloseMonth(r.Context(), closedBy, req.Year, req.Month, req.Reason)
	if err == nil {
		err = rs.queuePayrollDispatch(r.Context(), result)
	}
	if err != nil {
		tenant.MarkRollback(r.Context())
		renderMonthCloseError(w, r, err)
		return
	}
	common.Respond(w, r, http.StatusCreated, result, "Month closed")
}

// reopenMonth handles POST /api/staff/{id}/time-tracking/month-close/reopen.
// POST rather than DELETE because it carries a mandatory reason.
func (rs *StaffAdminResource) reopenMonth(w http.ResponseWriter, r *http.Request) {
	staffID, err := common.ParseID(r)
	if err != nil {
		common.RenderError(w, r, common.ErrorInvalidRequest(err))
		return
	}
	if !rs.requireBalanceAdjustmentStaff(w, r, staffID) {
		return
	}
	reopenedBy, err := rs.resolveEditorStaffID(r.Context())
	if err != nil {
		common.RenderError(w, r, ownStaffError(err))
		return
	}
	var req monthCloseRequest
	if err := render.DecodeJSON(r.Body, &req); err != nil {
		common.RenderError(w, r, common.ErrorInvalidRequest(err))
		return
	}
	if err := rs.MonthCloseService.ReopenMonth(r.Context(), staffID, reopenedBy, req.Year, req.Month, req.Reason); err != nil {
		tenant.MarkRollback(r.Context())
		renderMonthCloseError(w, r, err)
		return
	}
	common.Respond(w, r, http.StatusOK, nil, "Month reopened")
}
