package carecontracthttp

import (
	"context"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/render"

	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/modules/carecontract"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// OverrunResource serves /traeger/care-time-overruns (#4683, ADR 0156): the
// figures per school behind the right "Berichte lesen", the children by name
// only behind the right "Verträge verwalten". Both read each school in its
// own tenant transaction, so the routes carry no transaction.
type OverrunResource struct {
	evaluations   carecontract.OverrunEvaluations
	requireReport common.Middleware
	requireNames  common.Middleware
	lists         ListRenderer
}

// NewOverrunResource builds the resource; lists renders both exports
// (#4718).
func NewOverrunResource(evaluations carecontract.OverrunEvaluations, requireReport, requireNames common.Middleware, lists ListRenderer) *OverrunResource {
	if evaluations == nil || requireReport == nil || requireNames == nil || lists == nil {
		panic("care contract http: the evaluation, both right checks and the list renderer are required")
	}
	return &OverrunResource{evaluations: evaluations, requireReport: requireReport, requireNames: requireNames, lists: lists}
}

// Router returns the routes mounted at /traeger/care-time-overruns.
func (rs *OverrunResource) Router(protectedTraegerRoutes func(chi.Router, func(chi.Router, common.Middleware))) chi.Router {
	r := chi.NewRouter()
	r.Use(render.SetContentType(render.ContentTypeJSON))
	protectedTraegerRoutes(r, func(r chi.Router, _ common.Middleware) {
		r.With(rs.requireReport).Get("/", rs.summary)
		r.With(rs.requireReport).Get("/export", rs.exportSummary)
		r.With(rs.requireNames).Get("/children", rs.children)
		r.With(rs.requireNames).Get("/children/export", rs.exportChildren)
	})
	return r
}

func (rs *OverrunResource) summary(w http.ResponseWriter, r *http.Request) {
	rs.respond(w, r, rs.evaluations.OverrunSummary)
}

func (rs *OverrunResource) children(w http.ResponseWriter, r *http.Request) {
	rs.respond(w, r, rs.evaluations.OverrunChildren)
}

type evaluation func(context.Context, carecontract.Reviewer, carecontract.OverrunFilter) (carecontract.OverrunEvaluation, error)

func (rs *OverrunResource) respond(w http.ResponseWriter, r *http.Request, read evaluation) {
	result, _, ok := rs.evaluate(w, r, read)
	if !ok {
		return
	}
	common.Respond(w, r, http.StatusOK, result, "Care time overruns retrieved successfully")
}

// exportSummary answers GET /traeger/care-time-overruns/export: the figures
// per school as PDF, Excel or CSV (format=, CSV without one), for the
// filter's window and school (#4718).
func (rs *OverrunResource) exportSummary(w http.ResponseWriter, r *http.Request) {
	rs.export(w, r, rs.evaluations.OverrunSummary, overrunSchoolsTable)
}

// exportChildren answers GET /traeger/care-time-overruns/children/export:
// every child with an overrun by name, like the list, behind the same right.
// The evaluation writes the children shown to the access log of each school.
func (rs *OverrunResource) exportChildren(w http.ResponseWriter, r *http.Request) {
	rs.export(w, r, rs.evaluations.OverrunChildren, overrunChildrenTable)
}

func (rs *OverrunResource) export(w http.ResponseWriter, r *http.Request, read evaluation, table func(carecontract.OverrunEvaluation, carecontract.OverrunFilter) ListTable) {
	format, err := listFormat(r)
	if err != nil {
		common.RenderError(w, r, common.ErrorInvalidRequest(err))
		return
	}
	result, filter, ok := rs.evaluate(w, r, read)
	if !ok {
		return
	}
	writeList(w, r, rs.lists, format, table(result, filter))
}

func (rs *OverrunResource) evaluate(w http.ResponseWriter, r *http.Request, read evaluation) (carecontract.OverrunEvaluation, carecontract.OverrunFilter, bool) {
	reviewer, ok := reviewerOf(w, r)
	if !ok {
		return carecontract.OverrunEvaluation{}, carecontract.OverrunFilter{}, false
	}
	filter, err := overrunFilter(r)
	if err != nil {
		common.RenderError(w, r, common.ErrorInvalidRequest(err))
		return carecontract.OverrunEvaluation{}, carecontract.OverrunFilter{}, false
	}
	result, err := read(r.Context(), reviewer, filter)
	if errors.Is(err, carecontract.ErrOverrunWindowInvalid) {
		common.RenderError(w, r, common.ErrorInvalidRequest(err))
		return carecontract.OverrunEvaluation{}, carecontract.OverrunFilter{}, false
	}
	if err != nil {
		renderError(w, r, err)
		return carecontract.OverrunEvaluation{}, carecontract.OverrunFilter{}, false
	}
	return result, filter, true
}

// overrunFilter reads from, to (YYYY-MM-DD) and the optional school_id.
func overrunFilter(r *http.Request) (carecontract.OverrunFilter, error) {
	query := r.URL.Query()
	from, err := calendar.ParseDate(query.Get("from"))
	if err != nil {
		return carecontract.OverrunFilter{}, errors.New("invalid from")
	}
	to, err := calendar.ParseDate(query.Get("to"))
	if err != nil {
		return carecontract.OverrunFilter{}, errors.New("invalid to")
	}
	schoolID, err := optionalID(r, "school_id")
	if err != nil {
		return carecontract.OverrunFilter{}, err
	}
	return carecontract.OverrunFilter{From: from, To: to, SchoolID: schoolID}, nil
}
