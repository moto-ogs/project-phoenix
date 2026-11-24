// Package traegerviewhttp serves the Träger projection's reads in the
// Träger-Portal (ADR 0084). Its routes sit behind the Träger route group,
// which accepts only Träger sessions (scope org), and each route checks a
// Träger right. The Träger comes from the session, never from the request.
package traegerviewhttp

import (
	"context"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/render"

	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess"
	"github.com/moto-ogs/project-phoenix/modules/traegerview"
)

// Resource serves the Träger projection routes.
type Resource struct {
	overview traegerview.Overview
	reports  traegerview.Reports
	lists    common.ListRenderer
	modules  BookedModules
}

// BookedModules names the keys of the moto modules that count as booked for
// a Träger, in catalog order (#6052). The root binds it to the module
// switches of the Träger's schools: a module counts once one of them books
// it.
type BookedModules func(ctx context.Context, organizationID int64) ([]string, error)

// NewResource builds the resource. reports answers the heatmap of arrival
// and pickup times (#4714), the comparison of schools (#4715) and the daily
// attendance report of Mecklenburg-Vorpommern (#4717); lists renders the
// exports as PDF, Excel or CSV (#4718); modules names the booked modules the
// frame of the portal locks its navigation with (#6052).
func NewResource(overview traegerview.Overview, reports traegerview.Reports, lists common.ListRenderer, modules BookedModules) *Resource {
	if overview == nil || reports == nil || lists == nil || modules == nil {
		panic("traeger view http: the overview, the reports, the list renderer and the booked modules are required")
	}
	return &Resource{overview: overview, reports: reports, lists: lists, modules: modules}
}

// TraegerRouter returns the routes mounted at /traeger/schools inside the
// Träger route group the portal supplies.
// The projection reads in its own administrative unit, so it does not use
// the Träger transaction the group offers.
func (rs *Resource) TraegerRouter(protectedTraegerRoutes func(chi.Router, func(chi.Router, common.Middleware))) chi.Router {
	r := chi.NewRouter()
	r.Use(render.SetContentType(render.ContentTypeJSON))
	protectedTraegerRoutes(r, func(r chi.Router, _ common.Middleware) {
		r.With(common.RequiresPermission(identityaccess.TraegerRightOverviewRead)).Get("/", rs.listSchools)
		r.With(common.RequiresPermission(identityaccess.TraegerRightOverviewRead)).Get("/export", rs.listSchoolsExport)
		r.With(common.RequiresPermission(identityaccess.TraegerRightOverviewRead)).Get("/alerts", rs.schoolsAlerts)
		r.With(common.RequiresPermission(identityaccess.TraegerRightOverviewRead)).Get("/alerts/export", rs.schoolsAlertsExport)
		r.With(common.RequiresPermission(identityaccess.TraegerRightOverviewRead)).Get("/occupancy", rs.occupancy)
		r.With(common.RequiresPermission(identityaccess.TraegerRightOverviewRead)).Get("/occupancy/export", rs.occupancyExport)
		// The utilization over time is a report (#4713, ADR 0241): the
		// figures need "Berichte lesen", the children by name "Verträge
		// verwalten", the right that already opens the children of Soll und
		// Ist (ADR 0156).
		r.With(common.RequiresPermission(identityaccess.TraegerRightReportsRead)).Get("/utilization", rs.utilization)
		r.With(common.RequiresPermission(identityaccess.TraegerRightReportsRead)).Get("/utilization/export", rs.utilizationExport)
		r.With(common.RequiresPermission(identityaccess.TraegerRightContractsManage)).Get("/{id}/utilization/children", rs.utilizationChildren)
		r.With(common.RequiresPermission(identityaccess.TraegerRightReportsRead)).Get("/arrival-pickup-times", rs.arrivalPickupTimes)
		r.With(common.RequiresPermission(identityaccess.TraegerRightReportsRead)).Get("/arrival-pickup-times/export", rs.arrivalPickupTimesExport)
		// The daily attendance report of Mecklenburg-Vorpommern (#4717): the
		// figures and the anonymous file are reports, like the heatmap.
		r.With(common.RequiresPermission(identityaccess.TraegerRightReportsRead)).Get("/daily-attendance", rs.dailyAttendance)
		r.With(common.RequiresPermission(identityaccess.TraegerRightReportsRead)).Get("/daily-attendance/export", rs.dailyAttendanceExport)
		// The comparison of the schools is a report too (#4715, ADR 0245).
		r.With(common.RequiresPermission(identityaccess.TraegerRightReportsRead)).Get("/comparison", rs.comparison)
		r.With(common.RequiresPermission(identityaccess.TraegerRightReportsRead)).Get("/comparison/export", rs.comparisonExport)
		r.With(common.RequiresPermission(identityaccess.TraegerRightOverviewRead)).Get("/{id}", rs.getSchool)
	})
	return r
}

// TraegerOrganizationRouter returns the route mounted at /traeger/organization
// inside the Träger route group: the Träger of the session, which the portal
// frame names and marks as a test system (#4658), with the federal states of
// its schools, so the frame offers the daily attendance report of
// Mecklenburg-Vorpommern only there (#4717), and with the moto modules that
// count as booked for the Träger, so the frame locks the pages of the others
// (#6052). It needs the overview right
// every Träger role holds; the Träger name and its test mark are no personal
// data, so the read is not written to the access log.
func (rs *Resource) TraegerOrganizationRouter(protectedTraegerRoutes func(chi.Router, func(chi.Router, common.Middleware))) chi.Router {
	r := chi.NewRouter()
	r.Use(render.SetContentType(render.ContentTypeJSON))
	protectedTraegerRoutes(r, func(r chi.Router, _ common.Middleware) {
		r.With(common.RequiresPermission(identityaccess.TraegerRightOverviewRead)).Get("/", rs.getTraeger)
	})
	return r
}

func (rs *Resource) getTraeger(w http.ResponseWriter, r *http.Request) {
	principal, err := common.CurrentPrincipal(r.Context())
	if err != nil || principal.OrganizationID() <= 0 || principal.AccountID() <= 0 {
		common.RenderError(w, r, common.ErrorUnauthorized(common.ErrUnauthorized))
		return
	}
	traeger, err := rs.overview.Traeger(r.Context(), principal.OrganizationID(), principal.AccountID())
	var states []string
	if err == nil {
		states, err = rs.reports.FederalStates(r.Context(), principal.OrganizationID())
	}
	var modules []string
	if err == nil {
		modules, err = rs.modules(r.Context(), principal.OrganizationID())
	}
	if errors.Is(err, traegerview.ErrTraegerUnavailable) {
		common.RenderError(w, r, common.ErrorUnauthorized(common.ErrUnauthorized))
		return
	}
	if err != nil {
		common.RenderError(w, r, common.ErrorInternalServer(err))
		return
	}
	common.Respond(w, r, http.StatusOK, TraegerFrame{Traeger: traeger, FederalStates: states, BookedModules: modules}, "Träger retrieved successfully")
}

// TraegerFrame is the Träger of the session as the portal frame reads it.
type TraegerFrame struct {
	traegerview.Traeger
	FederalStates []string `json:"federal_states"`
	// BookedModules are the keys of the moto modules that count as booked
	// for the Träger: at least one of its schools books them (#6052).
	BookedModules []string `json:"booked_modules"`
}

// listSchools answers GET /traeger/schools: every school of the Träger of the
// session. School names are no personal data, so the read is not written to
// the access log (ADR 0084 section 7).
func (rs *Resource) listSchools(w http.ResponseWriter, r *http.Request) {
	principal, err := common.CurrentPrincipal(r.Context())
	if err != nil || principal.OrganizationID() <= 0 {
		common.RenderError(w, r, common.ErrorUnauthorized(common.ErrUnauthorized))
		return
	}
	schools, err := rs.overview.Schools(r.Context(), principal.OrganizationID())
	if errors.Is(err, traegerview.ErrTraegerUnavailable) {
		// The moto team deactivated the Träger: its session has ended.
		common.RenderError(w, r, common.ErrorUnauthorized(common.ErrUnauthorized))
		return
	}
	if err != nil {
		common.RenderError(w, r, common.ErrorInternalServer(err))
		return
	}
	common.Respond(w, r, http.StatusOK, schools, "Schools retrieved successfully")
}

// getSchool answers GET /traeger/schools/{id}: one school of the Träger of the
// session with its contact data and figures (#5686). Figures are aggregated
// numbers and a school's contact data is no personal data of a child or staff
// member, so the read is not written to the access log (ADR 0084 section 7).
// A school of another Träger and an unknown ID both answer 404
// traeger.school_not_found, like the Absprung, so the route reveals no school
// (#6461); a missing right stays a 403 of the permission middleware.
func (rs *Resource) getSchool(w http.ResponseWriter, r *http.Request) {
	principal, err := common.CurrentPrincipal(r.Context())
	if err != nil || principal.OrganizationID() <= 0 {
		common.RenderError(w, r, common.ErrorUnauthorized(common.ErrUnauthorized))
		return
	}
	schoolID, err := common.ParseIDParam(r, "id")
	if err != nil {
		common.RenderError(w, r, common.ErrorInvalidRequest(err))
		return
	}
	view, err := rs.overview.School(r.Context(), principal.OrganizationID(), schoolID)
	switch {
	case errors.Is(err, traegerview.ErrSchoolOutsideTraeger):
		common.RenderError(w, r, common.ErrorNotFoundWithCode(err, common.CodeTraegerSchoolNotFound))
	case errors.Is(err, traegerview.ErrTraegerUnavailable):
		common.RenderError(w, r, common.ErrorUnauthorized(common.ErrUnauthorized))
	case err != nil:
		common.RenderError(w, r, common.ErrorInternalServer(err))
	default:
		common.Respond(w, r, http.StatusOK, view, "School retrieved successfully")
	}
}

// schoolsAlerts answers GET /traeger/schools/alerts: the hints of every school
// of the Träger of the session against the Träger's thresholds (#4675). They
// are aggregated numbers, so the read is not written to the access log (ADR
// 0084 section 7).
func (rs *Resource) schoolsAlerts(w http.ResponseWriter, r *http.Request) {
	principal, err := common.CurrentPrincipal(r.Context())
	if err != nil || principal.OrganizationID() <= 0 {
		common.RenderError(w, r, common.ErrorUnauthorized(common.ErrUnauthorized))
		return
	}
	alerts, err := rs.overview.SchoolsAlerts(r.Context(), principal.OrganizationID())
	switch {
	case errors.Is(err, traegerview.ErrTraegerUnavailable):
		common.RenderError(w, r, common.ErrorUnauthorized(common.ErrUnauthorized))
	case err != nil:
		common.RenderError(w, r, common.ErrorInternalServer(err))
	default:
		common.Respond(w, r, http.StatusOK, alerts, "School alerts retrieved successfully")
	}
}
