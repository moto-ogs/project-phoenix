package staffcalendarhttp

import (
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/render"

	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/modules/schoolcalendar/traegercalendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

// TraegerOpeningChangeResource serves the opening changes of a Träger
// (#8202) at /traeger/opening-changes. Every route sits behind the Träger
// session and runs in the Träger transaction of the session's Träger
// (ADR 0105); the Träger comes from the session, never from the request.
// Reading needs "Übersicht sehen", planning "Einstellungen verwalten", as
// with the Träger's closing days: a change moves the end of every session at
// the named schools.
type TraegerOpeningChangeResource struct {
	changes       traegercalendar.OpeningChanges
	requireRead   common.Middleware
	requireManage common.Middleware
}

// NewTraegerOpeningChangeResource builds the resource; the root binds the
// right checks to the rights Identity & Access bundles into the Träger roles.
func NewTraegerOpeningChangeResource(changes traegercalendar.OpeningChanges, requireRead, requireManage common.Middleware) *TraegerOpeningChangeResource {
	if changes == nil || requireRead == nil || requireManage == nil {
		panic("school calendar http: the Träger opening changes and the right checks are required")
	}
	return &TraegerOpeningChangeResource{changes: changes, requireRead: requireRead, requireManage: requireManage}
}

// TraegerRouter returns the routes mounted at /traeger/opening-changes.
func (rs *TraegerOpeningChangeResource) TraegerRouter(protectedTraegerRoutes func(chi.Router, func(chi.Router, common.Middleware))) chi.Router {
	r := chi.NewRouter()
	r.Use(render.SetContentType(render.ContentTypeJSON))
	protectedTraegerRoutes(r, func(r chi.Router, withTx common.Middleware) {
		r.With(rs.requireRead, withTx).Get("/", rs.list)
		manage := r.With(rs.requireManage, withTx)
		manage.Post("/", rs.create)
		manage.Put("/{id}", rs.update)
		manage.Delete("/{id}", rs.delete)
	})
	return r
}

// TraegerOpeningChangeRequest is the body of POST /traeger/opening-changes
// and PUT /traeger/opening-changes/{id}. opens_at and closes_at are "HH:MM".
type TraegerOpeningChangeRequest struct {
	StartDate calendar.Date `json:"start_date"`
	EndDate   calendar.Date `json:"end_date"`
	OpensAt   string        `json:"opens_at"`
	ClosesAt  string        `json:"closes_at"`
	Reason    string        `json:"reason"`
	SchoolIDs []ident.ID    `json:"school_ids"`
	// ExpectedVersion is the version of the change an update replaces
	// (ADR 0311); a create ignores it.
	ExpectedVersion string `json:"expected_version,omitempty"`
}

// Bind accepts the body; the Owner validates the change.
func (req *TraegerOpeningChangeRequest) Bind(*http.Request) error { return nil }

func (req *TraegerOpeningChangeRequest) input() traegercalendar.OpeningChangeInput {
	return traegercalendar.OpeningChangeInput{
		StartDate: req.StartDate, EndDate: req.EndDate, OpensAt: req.OpensAt, ClosesAt: req.ClosesAt,
		Reason: req.Reason, SchoolIDs: ident.Int64s(req.SchoolIDs), ExpectedVersion: req.ExpectedVersion,
	}
}

// list answers GET /traeger/opening-changes?from=YYYY-MM-DD&to=YYYY-MM-DD.
func (rs *TraegerOpeningChangeResource) list(w http.ResponseWriter, r *http.Request) {
	organizationID, ok := traegerOf(w, r)
	if !ok {
		return
	}
	from, fromErr := calendar.ParseDate(r.URL.Query().Get("from"))
	to, toErr := calendar.ParseDate(r.URL.Query().Get("to"))
	if fromErr != nil || toErr != nil {
		common.RenderError(w, r, common.ErrorInvalidRequestWithCode(errors.Join(fromErr, toErr), common.CodeTraegerOpeningChangeInvalid))
		return
	}
	changes, err := rs.changes.ListOpeningChanges(r.Context(), organizationID, from, to)
	if err != nil {
		renderTraegerOpeningChangeError(w, r, err)
		return
	}
	common.Respond(w, r, http.StatusOK, changes, "Träger opening changes retrieved successfully")
}

func (rs *TraegerOpeningChangeResource) create(w http.ResponseWriter, r *http.Request) {
	organizationID, ok := traegerOf(w, r)
	if !ok {
		return
	}
	req := &TraegerOpeningChangeRequest{}
	if err := render.Bind(r, req); err != nil {
		common.RenderError(w, r, common.ErrorInvalidRequestWithCode(err, common.CodeTraegerOpeningChangeInvalid))
		return
	}
	change, err := rs.changes.CreateOpeningChange(r.Context(), organizationID, req.input())
	if err != nil {
		renderTraegerOpeningChangeError(w, r, err)
		return
	}
	common.Respond(w, r, http.StatusCreated, change, "Träger opening change created successfully")
}

func (rs *TraegerOpeningChangeResource) update(w http.ResponseWriter, r *http.Request) {
	organizationID, ok := traegerOf(w, r)
	if !ok {
		return
	}
	id, err := common.ParseID(r)
	if err != nil {
		common.RenderError(w, r, common.ErrorNotFoundWithCode(traegercalendar.ErrOpeningChangeNotFound, common.CodeTraegerOpeningChangeNotFound))
		return
	}
	req := &TraegerOpeningChangeRequest{}
	if err := render.Bind(r, req); err != nil {
		common.RenderError(w, r, common.ErrorInvalidRequestWithCode(err, common.CodeTraegerOpeningChangeInvalid))
		return
	}
	change, err := rs.changes.UpdateOpeningChange(r.Context(), organizationID, id, req.input())
	if err != nil {
		renderTraegerOpeningChangeError(w, r, err)
		return
	}
	common.Respond(w, r, http.StatusOK, change, "Träger opening change updated successfully")
}

func (rs *TraegerOpeningChangeResource) delete(w http.ResponseWriter, r *http.Request) {
	organizationID, ok := traegerOf(w, r)
	if !ok {
		return
	}
	id, err := common.ParseID(r)
	if err != nil {
		common.RenderError(w, r, common.ErrorNotFoundWithCode(traegercalendar.ErrOpeningChangeNotFound, common.CodeTraegerOpeningChangeNotFound))
		return
	}
	if err := rs.changes.DeleteOpeningChange(r.Context(), organizationID, id); err != nil {
		renderTraegerOpeningChangeError(w, r, err)
		return
	}
	common.Respond(w, r, http.StatusOK, CalendarStatusResponse{Status: "deleted"}, "Träger opening change deleted successfully")
}

// renderTraegerOpeningChangeError names a refusal. A change written since it
// was read keeps its readstate code through the shared classification.
func renderTraegerOpeningChangeError(w http.ResponseWriter, r *http.Request, err error) {
	var invalid *traegercalendar.InvalidOpeningChangeError
	switch {
	case errors.Is(err, traegercalendar.ErrOpeningChangeNotFound):
		common.RenderError(w, r, common.ErrorNotFoundWithCode(err, common.CodeTraegerOpeningChangeNotFound))
	case errors.Is(err, traegercalendar.ErrSchoolOutside):
		common.RenderError(w, r, common.ErrorInvalidOnField(err, common.CodeTraegerClosingDaySchoolOutside, "school_ids"))
	case errors.As(err, &invalid):
		common.RenderError(w, r, common.ErrorInvalidOnField(err, common.CodeTraegerOpeningChangeInvalid, invalid.Field))
	default:
		common.RenderError(w, r, common.ErrorInternalServer(err))
	}
}

// TraegerOpeningChangeRouteContracts registers the Träger's opening changes
// (#8202), with patterns relative to /traeger/opening-changes.
func TraegerOpeningChangeRouteContracts() []common.RouteContract {
	portals := []common.PortalScope{common.PortalTraeger}
	days := []common.QueryParam{{Name: "from", Kind: common.QueryDate}, {Name: "to", Kind: common.QueryDate}}
	return []common.RouteContract{
		{Method: "GET", Pattern: "/", Portals: portals, Query: days, Response: []traegercalendar.OpeningChange{}},
		{Method: "POST", Pattern: "/", Portals: portals, Request: TraegerOpeningChangeRequest{}, Response: traegercalendar.OpeningChange{}},
		{Method: "PUT", Pattern: "/{id}", Portals: portals, Request: TraegerOpeningChangeRequest{}, Response: traegercalendar.OpeningChange{}},
		{Method: "DELETE", Pattern: "/{id}", Portals: portals, Response: CalendarStatusResponse{}},
	}
}
