// Package daychangesviewhttp serves "Heute anders" (ADR 0299) at
// GET /api/day-changes/today inside the protected tenant routes.
package daychangesviewhttp

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/render"

	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/modules/daychangesview"
)

// Resource serves the overview route.
type Resource struct{ view daychangesview.Query }

// NewResource builds the resource; the view is required.
func NewResource(view daychangesview.Query) *Resource {
	if view == nil {
		panic("day changes view http: the view is required")
	}
	return &Resource{view: view}
}

// RouteContracts registers the overview (ADR 0270) relative to
// /api/day-changes. It has no date parameter: the backend reads today of the
// school.
func RouteContracts() []common.RouteContract {
	return []common.RouteContract{{
		Method: "GET", Pattern: "/today", Portals: []common.PortalScope{common.PortalTenant},
		Response: daychangesview.Overview{},
		Enums: []common.EnumContract{
			{Type: daychangesview.Section(""), Values: []string{string(daychangesview.SectionYou), string(daychangesview.SectionSchool)}},
			{Type: daychangesview.Source(""), Values: []string{string(daychangesview.SourceStaff), string(daychangesview.SourceClosingDays)}},
			{Type: daychangesview.SourceState(""), Values: []string{string(daychangesview.SourceLoaded), string(daychangesview.SourceFailed)}},
			{Type: daychangesview.Kind(""), Values: []string{
				string(daychangesview.KindStaffAbsent), string(daychangesview.KindStaffAbsentCount),
				string(daychangesview.KindGroupSubstitution), string(daychangesview.KindGroupSubstitutionCount),
				string(daychangesview.KindClosingDay),
			}},
			{Type: daychangesview.PersonRole(""), Values: []string{
				string(daychangesview.RoleAbsent), string(daychangesview.RoleSubstitute), string(daychangesview.RoleReplaced),
			}},
			{Type: daychangesview.LinkTarget(""), Values: []string{
				string(daychangesview.LinkStaffAbsences), string(daychangesview.LinkStaffMember), string(daychangesview.LinkOwnAbsences),
				string(daychangesview.LinkStaffList), string(daychangesview.LinkGroupHandovers),
				string(daychangesview.LinkCalendarPeriods),
			}},
		},
	}}
}

// Router mounts GET /today inside the protected tenant routes. The route
// needs no single permission: every source applies its own rule, and a
// source the caller may not read answers without entries.
func (rs *Resource) Router(protected func(chi.Router, func(chi.Router, common.Middleware))) chi.Router {
	r := chi.NewRouter()
	r.Use(render.SetContentType(render.ContentTypeJSON))
	protected(r, func(r chi.Router, withTx common.Middleware) {
		r.With(withTx).Get("/today", rs.today)
	})
	return r
}

func (rs *Resource) today(w http.ResponseWriter, r *http.Request) {
	overview, err := rs.view.Today(r.Context())
	if err != nil {
		common.RenderError(w, r, common.ErrorInternalServerWrap("failed to read the day changes", err))
		return
	}
	common.Respond(w, r, http.StatusOK, overview, "Day changes retrieved successfully")
}
