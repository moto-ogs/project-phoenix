package daychangesviewhttp

import (
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/render"

	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/modules/daychangesview"
)

// SchoolRouteContracts registers the overview of moto schule (#7670)
// relative to /school/day-changes: the answer of the staff portal's route
// for the school portal.
func SchoolRouteContracts() []common.RouteContract {
	contract := RouteContracts()[0]
	contract.Portals = []common.PortalScope{common.PortalSchool}
	return []common.RouteContract{contract}
}

// SchoolResource serves the overview of moto schule (#7670).
type SchoolResource struct {
	resource   *Resource
	permission string
}

// NewSchoolResource builds the school portal's resource. The root names the
// permission of the route, class_day:read: the overview of a Lehrkraft is the
// one of her classes. Both are required.
func NewSchoolResource(view daychangesview.Query, permission string) *SchoolResource {
	if permission == "" {
		panic("day changes view http: the school route needs its permission")
	}
	return &SchoolResource{resource: NewResource(view), permission: permission}
}

// SchoolRouter mounts GET /today inside the protected school routes, behind
// the permission. Every source applies its own rule on top.
func (rs *SchoolResource) SchoolRouter(protected func(chi.Router, func(chi.Router, common.Middleware))) chi.Router {
	r := chi.NewRouter()
	r.Use(render.SetContentType(render.ContentTypeJSON))
	protected(r, func(r chi.Router, withTx common.Middleware) {
		r.With(common.RequiresPermission(rs.permission), withTx).Get("/today", rs.resource.today)
	})
	return r
}
