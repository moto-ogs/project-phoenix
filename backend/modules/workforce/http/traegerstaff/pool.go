package traegerstaff

import (
	"errors"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/render"

	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/modules/workforce"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// The Vertretungspool (#4709, ADR 0089 section 9). The school reads and
// blocks the Springer of its Träger at /api/staff-pool with the right of
// the Dienstplan; the Personalverwaltung reads every block and lifts one at
// /traeger/staff-pool with the Träger right „Personal“.

// SchoolPoolResource serves the pool of the school's Träger to the school.
type SchoolPoolResource struct {
	pool          workforce.SchoolStaffPool
	requireManage common.Middleware
}

// NewSchoolPoolResource builds the school's routes; the root binds
// requireManage to time_tracking:manage, the right that plans shifts.
func NewSchoolPoolResource(pool workforce.SchoolStaffPool, requireManage common.Middleware) *SchoolPoolResource {
	if pool == nil || requireManage == nil {
		panic("workforce staff pool: the pool and the right check are required")
	}
	return &SchoolPoolResource{pool: pool, requireManage: requireManage}
}

// Router returns the routes mounted at /api/staff-pool, each in the
// tenant transaction of the request.
func (rs *SchoolPoolResource) Router(protectedTenantRoutes func(chi.Router, func(chi.Router, common.Middleware))) chi.Router {
	r := chi.NewRouter()
	r.Use(render.SetContentType(render.ContentTypeJSON))
	protectedTenantRoutes(r, func(r chi.Router, withTx common.Middleware) {
		manage := r.With(rs.requireManage, withTx)
		manage.Get("/", rs.week)
		manage.Post("/blocks", rs.block)
		manage.Delete("/blocks/{id}", rs.lift)
	})
	return r
}

func schoolActor(w http.ResponseWriter, r *http.Request) (workforce.SchoolPoolActor, bool) {
	principal, err := common.CurrentPrincipal(r.Context())
	if err != nil || principal.TenantID() <= 0 || principal.AccountID() <= 0 {
		common.RenderError(w, r, common.ErrorUnauthorized(common.ErrUnauthorized))
		return workforce.SchoolPoolActor{}, false
	}
	return workforce.SchoolPoolActor{AccountID: principal.AccountID(), Role: strings.Join(principal.Roles(), ",")}, true
}

// weekParam reads ?week=YYYY-MM-DD; empty is this week.
func weekParam(w http.ResponseWriter, r *http.Request) (calendar.Date, bool) {
	raw := r.URL.Query().Get("week")
	if raw == "" {
		return "", true
	}
	parsed, err := calendar.ParseDate(raw)
	if err != nil {
		common.RenderError(w, r, common.ErrorInvalidRequest(errors.New("week must be YYYY-MM-DD")))
		return "", false
	}
	return parsed, true
}

func (rs *SchoolPoolResource) week(w http.ResponseWriter, r *http.Request) {
	actor, ok := schoolActor(w, r)
	if !ok {
		return
	}
	weekStart, ok := weekParam(w, r)
	if !ok {
		return
	}
	week, err := rs.pool.SchoolPoolWeek(r.Context(), actor, weekStart)
	if err != nil {
		common.RenderError(w, r, poolErrors(err))
		return
	}
	common.Respond(w, r, http.StatusOK, week, "Staff pool retrieved successfully")
}

// blockRequest blocks a Springer on one day from start to end.
type blockRequest struct {
	RecordID  int64  `json:"staff_record_id,string"`
	Date      string `json:"date"`
	StartTime string `json:"start_time"`
	EndTime   string `json:"end_time"`
}

func (req *blockRequest) Bind(*http.Request) error {
	if req.RecordID <= 0 {
		return errors.New("staff_record_id is required")
	}
	if _, err := calendar.ParseDate(req.Date); err != nil {
		return errors.New("date must be YYYY-MM-DD")
	}
	return nil
}

// invalidField names the field Bind refused, for the error at the field.
func (req *blockRequest) invalidField() string {
	if req.RecordID <= 0 {
		return "staff_record_id"
	}
	return "date"
}

func (rs *SchoolPoolResource) block(w http.ResponseWriter, r *http.Request) {
	actor, ok := schoolActor(w, r)
	if !ok {
		return
	}
	var req blockRequest
	if err := render.Bind(r, &req); err != nil {
		common.RenderError(w, r, common.ErrorInvalidOnField(err, common.CodeWorkforcePoolBlockInvalid, req.invalidField()))
		return
	}
	block, err := rs.pool.BlockSpringer(r.Context(), actor, workforce.PoolBlockInput{
		RecordID: req.RecordID, Date: calendar.Date(req.Date), StartTime: req.StartTime, EndTime: req.EndTime,
	})
	if err != nil {
		common.RenderError(w, r, poolErrors(err))
		return
	}
	common.Respond(w, r, http.StatusCreated, block, "Springer blocked successfully")
}

func (rs *SchoolPoolResource) lift(w http.ResponseWriter, r *http.Request) {
	actor, ok := schoolActor(w, r)
	if !ok {
		return
	}
	id, ok := common.ParseInt64IDWithError(w, r, "id", "invalid block ID")
	if !ok {
		return
	}
	if err := rs.pool.LiftSchoolBlock(r.Context(), actor, id); err != nil {
		common.RenderError(w, r, poolErrors(err))
		return
	}
	common.Respond(w, r, http.StatusOK, nil, "Block lifted successfully")
}

// TraegerPoolResource serves the pool to the Personalverwaltung.
type TraegerPoolResource struct {
	pool         workforce.TraegerStaffPool
	requireStaff common.Middleware
}

// NewTraegerPoolResource builds the Träger's routes; the root binds
// requireStaff to the Träger right traeger_staff:manage.
func NewTraegerPoolResource(pool workforce.TraegerStaffPool, requireStaff common.Middleware) *TraegerPoolResource {
	if pool == nil || requireStaff == nil {
		panic("workforce traeger staff pool: the pool and the right check are required")
	}
	return &TraegerPoolResource{pool: pool, requireStaff: requireStaff}
}

// TraegerRouter returns the routes mounted at /traeger/staff-pool; the
// owner opens the transactions itself (ADR 0105).
func (rs *TraegerPoolResource) TraegerRouter(protectedTraegerRoutes func(chi.Router, func(chi.Router, common.Middleware))) chi.Router {
	r := chi.NewRouter()
	r.Use(render.SetContentType(render.ContentTypeJSON))
	protectedTraegerRoutes(r, func(r chi.Router, _ common.Middleware) {
		staff := r.With(rs.requireStaff)
		staff.Get("/", rs.week)
		staff.Delete("/blocks/{id}", rs.lift)
	})
	return r
}

func (rs *TraegerPoolResource) week(w http.ResponseWriter, r *http.Request) {
	session, ok := actor(w, r)
	if !ok {
		return
	}
	weekStart, ok := weekParam(w, r)
	if !ok {
		return
	}
	week, err := rs.pool.TraegerPoolWeek(r.Context(), session, weekStart)
	if err != nil {
		common.RenderError(w, r, poolErrors(err))
		return
	}
	common.Respond(w, r, http.StatusOK, week, "Staff pool retrieved successfully")
}

func (rs *TraegerPoolResource) lift(w http.ResponseWriter, r *http.Request) {
	session, ok := actor(w, r)
	if !ok {
		return
	}
	id, ok := common.ParseInt64IDWithError(w, r, "id", "invalid block ID")
	if !ok {
		return
	}
	if err := rs.pool.LiftTraegerBlock(r.Context(), session, id); err != nil {
		common.RenderError(w, r, poolErrors(err))
		return
	}
	common.Respond(w, r, http.StatusOK, nil, "Block lifted successfully")
}

var poolErrors = common.RulesRenderer([]common.ErrorRule{
	{Target: workforce.ErrTraegerStaffNotReleased, Render: coded(common.ErrorConflictWithCode, common.CodeWorkforceTraegerStaffNotReleased)},
	{Target: workforce.ErrPoolSpringerNotFound, Render: coded(common.ErrorNotFoundWithCode, common.CodeWorkforcePoolSpringerNotFound)},
	{Target: workforce.ErrPoolBlockTaken, Render: coded(common.ErrorConflictWithCode, common.CodeWorkforcePoolBlockTaken)},
	{Target: workforce.ErrPoolSpringerBusy, Render: coded(common.ErrorConflictWithCode, common.CodeWorkforcePoolSpringerBusy)},
	{Target: workforce.ErrPoolBlockNotFound, Render: coded(common.ErrorNotFoundWithCode, common.CodeWorkforcePoolBlockNotFound)},
	{Target: workforce.ErrPoolBlockInvalid, Render: coded(common.ErrorInvalidRequestWithCode, common.CodeWorkforcePoolBlockInvalid)},
}, common.ErrorInternalServer)
