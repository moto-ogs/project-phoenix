package staffcalendarhttp

import (
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/render"

	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/auth/authorize/permissions"
	"github.com/moto-ogs/project-phoenix/modules/schoolcalendar/openinghours"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

// OpeningChangeResource serves the changed opening hours of a school
// (#7654) at /api/opening-changes. They are maintained on the page of the
// closing days, so the routes carry the same rights: schedules:read to read,
// schedules:create/update/delete to write. Every route runs in the school's
// tenant transaction; the school comes from the session.
type OpeningChangeResource struct {
	changes openinghours.Changes
}

// NewOpeningChangeResource builds the resource over the opening changes.
func NewOpeningChangeResource(changes openinghours.Changes) *OpeningChangeResource {
	if changes == nil {
		panic("school calendar http: the opening changes are required")
	}
	return &OpeningChangeResource{changes: changes}
}

// Router returns the routes mounted at /api/opening-changes.
func (rs *OpeningChangeResource) Router(protectedTenantRoutes func(chi.Router, func(chi.Router, common.Middleware))) chi.Router {
	r := chi.NewRouter()
	r.Use(render.SetContentType(render.ContentTypeJSON))
	protectedTenantRoutes(r, func(r chi.Router, withTx common.Middleware) {
		r.With(common.RequiresPermission(permissions.SchedulesRead), withTx).Get("/", rs.list)
		r.With(common.RequiresPermission(permissions.SchedulesCreate), withTx).Post("/", rs.create)
		r.With(common.RequiresPermission(permissions.SchedulesUpdate), withTx).Put("/{id}", rs.update)
		r.With(common.RequiresPermission(permissions.SchedulesDelete), withTx).Delete("/{id}", rs.delete)
	})
	return r
}

// OpeningChangeRequest is the body of POST /api/opening-changes and PUT
// /api/opening-changes/{id}. opens_at and closes_at are "HH:MM".
type OpeningChangeRequest struct {
	StartDate calendar.Date `json:"start_date"`
	EndDate   calendar.Date `json:"end_date"`
	OpensAt   string        `json:"opens_at"`
	ClosesAt  string        `json:"closes_at"`
	Reason    string        `json:"reason"`
	// ExpectedVersion is the version of the change an update replaces
	// (ADR 0311); a create ignores it.
	ExpectedVersion string `json:"expected_version,omitempty"`
}

// Bind accepts the body; the owner validates the change.
func (req *OpeningChangeRequest) Bind(*http.Request) error { return nil }

func (req *OpeningChangeRequest) input() openinghours.Input {
	return openinghours.Input{
		StartDate: req.StartDate, EndDate: req.EndDate, OpensAt: req.OpensAt, ClosesAt: req.ClosesAt,
		Reason: req.Reason, ExpectedVersion: req.ExpectedVersion,
	}
}

// OpeningChangeResponse is one opening change.
type OpeningChangeResponse struct {
	ID        ident.ID      `json:"id"`
	StartDate calendar.Date `json:"start_date"`
	EndDate   calendar.Date `json:"end_date"`
	OpensAt   string        `json:"opens_at"`
	ClosesAt  string        `json:"closes_at"`
	Reason    string        `json:"reason"`
	// Version is the token an update sends back as expected_version.
	Version string `json:"version"`
}

func openingChangeResponse(change openinghours.Change) OpeningChangeResponse {
	return OpeningChangeResponse{
		ID: ident.ID(change.ID), StartDate: change.StartDate, EndDate: change.EndDate,
		OpensAt: change.OpensAt, ClosesAt: change.ClosesAt, Reason: change.Reason, Version: change.Version(),
	}
}

// list answers GET /api/opening-changes?from=YYYY-MM-DD&to=YYYY-MM-DD.
func (rs *OpeningChangeResource) list(w http.ResponseWriter, r *http.Request) {
	from, fromErr := calendar.ParseDate(r.URL.Query().Get("from"))
	to, toErr := calendar.ParseDate(r.URL.Query().Get("to"))
	if fromErr != nil || toErr != nil {
		common.RenderError(w, r, common.ErrorInvalidRequestWithCode(errors.Join(fromErr, toErr), common.CodeCalendarOpeningChangeInvalid))
		return
	}
	changes, err := rs.changes.ListOpeningChanges(r.Context(), from, to)
	if err != nil {
		renderOpeningChangeError(w, r, err)
		return
	}
	responses := make([]OpeningChangeResponse, 0, len(changes))
	for _, change := range changes {
		responses = append(responses, openingChangeResponse(change))
	}
	common.Respond(w, r, http.StatusOK, responses, "Opening changes retrieved successfully")
}

func (rs *OpeningChangeResource) create(w http.ResponseWriter, r *http.Request) {
	req := &OpeningChangeRequest{}
	if err := render.Bind(r, req); err != nil {
		common.RenderError(w, r, common.ErrorInvalidRequestWithCode(err, common.CodeCalendarOpeningChangeInvalid))
		return
	}
	change, err := rs.changes.CreateOpeningChange(r.Context(), req.input())
	if err != nil {
		renderOpeningChangeError(w, r, err)
		return
	}
	common.Respond(w, r, http.StatusCreated, openingChangeResponse(change), "Opening change created successfully")
}

func (rs *OpeningChangeResource) update(w http.ResponseWriter, r *http.Request) {
	id, ok := common.ParsePositiveInt64IDWithError(w, r, "id", "invalid opening change ID")
	if !ok {
		return
	}
	req := &OpeningChangeRequest{}
	if err := render.Bind(r, req); err != nil {
		common.RenderError(w, r, common.ErrorInvalidRequestWithCode(err, common.CodeCalendarOpeningChangeInvalid))
		return
	}
	change, err := rs.changes.UpdateOpeningChange(r.Context(), id, req.input())
	if err != nil {
		renderOpeningChangeError(w, r, err)
		return
	}
	common.Respond(w, r, http.StatusOK, openingChangeResponse(change), "Opening change updated successfully")
}

func (rs *OpeningChangeResource) delete(w http.ResponseWriter, r *http.Request) {
	id, ok := common.ParsePositiveInt64IDWithError(w, r, "id", "invalid opening change ID")
	if !ok {
		return
	}
	if err := rs.changes.DeleteOpeningChange(r.Context(), id); err != nil {
		renderOpeningChangeError(w, r, err)
		return
	}
	common.Respond(w, r, http.StatusOK, CalendarStatusResponse{Status: "deleted"}, "Opening change deleted successfully")
}

// renderOpeningChangeError names a refusal. A change written since it was
// read keeps its readstate code through the shared classification.
func renderOpeningChangeError(w http.ResponseWriter, r *http.Request, err error) {
	var invalid *openinghours.InvalidError
	switch {
	case errors.Is(err, openinghours.ErrNotFound):
		common.RenderError(w, r, common.ErrorNotFoundWithCode(err, common.CodeCalendarOpeningChangeNotFound))
	case errors.As(err, &invalid):
		common.RenderError(w, r, common.ErrorInvalidOnField(err, common.CodeCalendarOpeningChangeInvalid, invalid.Field))
	default:
		common.RenderError(w, r, common.ErrorInternalServer(err))
	}
}

// OpeningChangeRouteContracts registers the opening changes (#7654), with
// patterns relative to /api/opening-changes.
func OpeningChangeRouteContracts() []common.RouteContract {
	portals := []common.PortalScope{common.PortalTenant}
	days := []common.QueryParam{{Name: "from", Kind: common.QueryDate}, {Name: "to", Kind: common.QueryDate}}
	return []common.RouteContract{
		{Method: "GET", Pattern: "/", Portals: portals, Query: days, Response: []OpeningChangeResponse{}},
		{Method: "POST", Pattern: "/", Portals: portals, Request: OpeningChangeRequest{}, Response: OpeningChangeResponse{}},
		{Method: "PUT", Pattern: "/{id}", Portals: portals, Request: OpeningChangeRequest{}, Response: OpeningChangeResponse{}},
		{Method: "DELETE", Pattern: "/{id}", Portals: portals, Response: CalendarStatusResponse{}},
	}
}
