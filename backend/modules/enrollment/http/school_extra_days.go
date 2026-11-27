package enrollmenthttp

import (
	"context"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/render"

	"github.com/moto-ogs/project-phoenix/api/common"
	capability "github.com/moto-ogs/project-phoenix/modules/enrollment"
	"github.com/moto-ogs/project-phoenix/tenant"
)

// SchoolExtraDayResource serves the extra care days a school plans for
// itself (#4817, ADR 0329) at /api/holiday-extra-days, behind the school
// session and the right that plans the school's closing days. The days are
// rows of the school's Träger. No route opens a transaction around the
// handler: it reads the Träger of the session's school in the school's unit
// and then opens the Träger transaction of that Träger on its own, never
// nested. The school and its Träger come from the session, never from the
// request.
type SchoolExtraDayResource struct {
	days          capability.SchoolExtraDays
	traeger       capability.HolidayHostTraeger
	requireManage common.Middleware
}

// NewSchoolExtraDayResource builds the routes. requireManage admits only a
// session with the school's right to plan its calendar.
func NewSchoolExtraDayResource(days capability.SchoolExtraDays, traeger capability.HolidayHostTraeger, requireManage common.Middleware) *SchoolExtraDayResource {
	if days == nil || traeger == nil || requireManage == nil {
		panic("enrollment http: the school's extra days, its Träger and the right check are required")
	}
	return &SchoolExtraDayResource{days: days, traeger: traeger, requireManage: requireManage}
}

// Router returns the routes mounted at /holiday-extra-days.
func (rs *SchoolExtraDayResource) Router(protectedTenantRoutes func(chi.Router, func(chi.Router, common.Middleware))) chi.Router {
	r := chi.NewRouter()
	r.Use(render.SetContentType(render.ContentTypeJSON))
	protectedTenantRoutes(r, func(r chi.Router, _ common.Middleware) {
		manage := r.With(rs.requireManage)
		manage.Get("/", rs.list)
		manage.Post("/", rs.create)
		manage.Get("/{id}", rs.get)
		manage.Put("/{id}", rs.update)
		manage.Post("/{id}/publish", rs.publish)
	})
	return r
}

// errSchoolWithoutTraeger reports a school without a Träger; every school
// has one, so it is a broken school row.
var errSchoolWithoutTraeger = errors.New("the school has no Träger to plan an extra day with")

// withinSchoolTraeger runs fn in the Träger transaction of the Träger of
// the session's school (ADR 0329). The session's school is masked: the unit
// carries the Träger alone, like a route of the Träger-Portal.
func withinSchoolTraeger(ctx context.Context, organizationID int64, fn func(context.Context) error) error {
	return tenant.WithinTraeger(tenant.ContextWithoutTenant(ctx), organizationID, fn)
}

// schoolTraeger names the session's school and its Träger.
func (rs *SchoolExtraDayResource) schoolTraeger(r *http.Request) (schoolID, organizationID int64, err error) {
	principal, err := common.CurrentPrincipal(r.Context())
	if err != nil || principal.TenantID() <= 0 {
		return 0, 0, common.ErrUnauthorized
	}
	schoolID = principal.TenantID()
	err = withinTenant(r.Context(), schoolID, func(ctx context.Context) error {
		organizationID, err = rs.traeger.HolidayHostTraeger(ctx, schoolID)
		return err
	})
	if err == nil && organizationID <= 0 {
		err = errSchoolWithoutTraeger
	}
	return schoolID, organizationID, err
}

// run answers one command on the school's extra days in the Träger unit.
func (rs *SchoolExtraDayResource) run(w http.ResponseWriter, r *http.Request, status int, message string,
	command func(ctx context.Context, organizationID, schoolID int64) (capability.HolidayPeriod, error),
) {
	schoolID, organizationID, err := rs.schoolTraeger(r)
	var period capability.HolidayPeriod
	if err == nil {
		err = withinSchoolTraeger(r.Context(), organizationID, func(ctx context.Context) error {
			period, err = command(ctx, organizationID, schoolID)
			return err
		})
	}
	if err != nil {
		renderSchoolExtraDayError(w, r, err)
		return
	}
	common.Respond(w, r, status, period, message)
}

func renderSchoolExtraDayError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, common.ErrUnauthorized):
		common.RenderError(w, r, common.ErrorUnauthorized(err))
	case errors.Is(err, capability.ErrSchoolExtraDayForeignSchool):
		common.RenderError(w, r, common.ErrorForbidden(err))
	default:
		renderHolidayPeriodError(w, r, err)
	}
}

func (rs *SchoolExtraDayResource) list(w http.ResponseWriter, r *http.Request) {
	schoolID, organizationID, err := rs.schoolTraeger(r)
	var days []capability.HolidayPeriod
	if err == nil {
		err = withinSchoolTraeger(r.Context(), organizationID, func(ctx context.Context) error {
			days, err = rs.days.ListSchoolExtraDays(ctx, organizationID, schoolID)
			return err
		})
	}
	if err != nil {
		renderSchoolExtraDayError(w, r, err)
		return
	}
	common.Respond(w, r, http.StatusOK, days, "Extra care days retrieved successfully")
}

func (rs *SchoolExtraDayResource) get(w http.ResponseWriter, r *http.Request) {
	periodID, err := common.ParseIDParam(r, "id")
	if err != nil {
		common.RenderError(w, r, common.ErrorInvalidRequest(err))
		return
	}
	rs.run(w, r, http.StatusOK, "Extra care day retrieved successfully", func(ctx context.Context, organizationID, schoolID int64) (capability.HolidayPeriod, error) {
		return rs.days.SchoolExtraDay(ctx, organizationID, schoolID, periodID)
	})
}

func (rs *SchoolExtraDayResource) create(w http.ResponseWriter, r *http.Request) {
	req := &HolidayPeriodRequest{}
	if err := render.Bind(r, req); err != nil {
		common.RenderError(w, r, common.ErrorInvalidRequest(err))
		return
	}
	rs.run(w, r, http.StatusCreated, "Extra care day created successfully", func(ctx context.Context, organizationID, schoolID int64) (capability.HolidayPeriod, error) {
		return rs.days.CreateSchoolExtraDay(ctx, organizationID, schoolID, req.input())
	})
}

func (rs *SchoolExtraDayResource) update(w http.ResponseWriter, r *http.Request) {
	periodID, err := common.ParseIDParam(r, "id")
	if err != nil {
		common.RenderError(w, r, common.ErrorInvalidRequest(err))
		return
	}
	req := &HolidayPeriodRequest{}
	if err := render.Bind(r, req); err != nil {
		common.RenderError(w, r, common.ErrorInvalidRequest(err))
		return
	}
	rs.run(w, r, http.StatusOK, "Extra care day updated successfully", func(ctx context.Context, organizationID, schoolID int64) (capability.HolidayPeriod, error) {
		return rs.days.UpdateSchoolExtraDay(ctx, organizationID, schoolID, periodID, req.input())
	})
}

func (rs *SchoolExtraDayResource) publish(w http.ResponseWriter, r *http.Request) {
	periodID, err := common.ParseIDParam(r, "id")
	if err != nil {
		common.RenderError(w, r, common.ErrorInvalidRequest(err))
		return
	}
	rs.run(w, r, http.StatusOK, "Extra care day published successfully", func(ctx context.Context, organizationID, schoolID int64) (capability.HolidayPeriod, error) {
		return rs.days.PublishSchoolExtraDay(ctx, organizationID, schoolID, periodID)
	})
}
