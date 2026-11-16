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
	lists        common.ListRenderer
}

// NewTraegerPoolResource builds the Träger's routes; the root binds
// requireStaff to the Träger right traeger_staff:manage and lists to
// Document Rendering (#4718).
func NewTraegerPoolResource(pool workforce.TraegerStaffPool, requireStaff common.Middleware, lists common.ListRenderer) *TraegerPoolResource {
	if pool == nil || requireStaff == nil || lists == nil {
		panic("workforce traeger staff pool: the pool, the right check and the list renderer are required")
	}
	return &TraegerPoolResource{pool: pool, requireStaff: requireStaff, lists: lists}
}

// TraegerRouter returns the routes mounted at /traeger/staff-pool; the
// owner opens the transactions itself (ADR 0105).
func (rs *TraegerPoolResource) TraegerRouter(protectedTraegerRoutes func(chi.Router, func(chi.Router, common.Middleware))) chi.Router {
	r := chi.NewRouter()
	r.Use(render.SetContentType(render.ContentTypeJSON))
	protectedTraegerRoutes(r, func(r chi.Router, _ common.Middleware) {
		staff := r.With(rs.requireStaff)
		staff.Get("/", rs.week)
		staff.Get("/export", rs.export)
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
	week, err := rs.pool.TraegerPoolWeek(r.Context(), session, weekStart, workforce.TraegerStaffViewPool)
	if err != nil {
		common.RenderError(w, r, poolErrors(err))
		return
	}
	common.Respond(w, r, http.StatusOK, week, "Staff pool retrieved successfully")
}

// export answers the week's blocks as PDF, Excel or CSV (format=, CSV
// without one), logged at the same schools as the page (#4718).
func (rs *TraegerPoolResource) export(w http.ResponseWriter, r *http.Request) {
	session, ok := actor(w, r)
	if !ok {
		return
	}
	weekStart, ok := weekParam(w, r)
	if !ok {
		return
	}
	format, ok := common.ListFormatOf(w, r)
	if !ok {
		return
	}
	week, err := rs.pool.TraegerPoolWeek(r.Context(), session, weekStart, workforce.TraegerStaffViewPoolExport)
	if err != nil {
		common.RenderError(w, r, poolErrors(err))
		return
	}
	common.WriteList(w, r, rs.lists, format, poolWeekTable(week))
}

// poolWeekTable lists the live blocks of the week, one row each, by
// Springer and time as the page shows them.
func poolWeekTable(week workforce.PoolWeek) common.ListTable {
	rows := [][]string{}
	for _, springer := range week.Springers {
		for _, block := range springer.Blocks {
			rows = append(rows, []string{
				springer.LastName, springer.FirstName, germanDay(block.Date.String()),
				block.StartTime, block.EndTime, block.SchoolName,
			})
		}
	}
	return common.ListTable{
		Title:    "Vertretungspool",
		Subtitle: "Woche " + germanDay(week.WeekStart.String()) + " bis " + germanDay(week.WeekStart.AddDays(6).String()),
		Filters:  []string{"Alle Springer und Schulen"},
		Columns: []common.ListColumn{
			{ID: "last_name", Label: "Nachname"}, {ID: "first_name", Label: "Vorname"}, {ID: "date", Label: "Tag"},
			{ID: "start_time", Label: "Beginn"}, {ID: "end_time", Label: "Ende"}, {ID: "school", Label: "Schule"},
		},
		Rows: rows, Footer: "Vertraulich. Enthält personenbezogene Daten.",
		Filename: "vertretungspool-" + week.WeekStart.String(),
	}
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
