package traeger

import (
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/render"
	validation "github.com/go-ozzo/ozzo-validation"

	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/modules/organizationtenancy"
)

// ReportTemplateResource serves the report templates of the session's Träger
// (#4716, ADR 0246) at /traeger/report-templates. Every route sits behind
// the Träger session and runs in the Träger transaction of that Träger (ADR
// 0105). Reading needs "Berichte lesen", the right of the reports the
// templates shape; writing needs "Einstellungen". A template names no person,
// so a read writes no log; every write is logged in the master data log.
type ReportTemplateResource struct {
	templates     organizationtenancy.TraegerReportTemplates
	requireRead   common.Middleware
	requireManage common.Middleware
}

// NewReportTemplateResource builds the resource. The root binds requireRead
// and requireManage to the Träger rights of Identity & Access.
func NewReportTemplateResource(templates organizationtenancy.TraegerReportTemplates, requireRead, requireManage common.Middleware) *ReportTemplateResource {
	if templates == nil || requireRead == nil || requireManage == nil {
		panic("organization tenancy traeger: the report templates and the right checks are required")
	}
	return &ReportTemplateResource{templates: templates, requireRead: requireRead, requireManage: requireManage}
}

// TraegerRouter returns the routes mounted at /traeger/report-templates.
func (rs *ReportTemplateResource) TraegerRouter(protectedTraegerRoutes func(chi.Router, func(chi.Router, common.Middleware))) chi.Router {
	r := chi.NewRouter()
	r.Use(render.SetContentType(render.ContentTypeJSON))
	protectedTraegerRoutes(r, func(r chi.Router, withTx common.Middleware) {
		r.With(rs.requireRead, withTx).Get("/", rs.list)
		manage := r.With(rs.requireManage, withTx)
		manage.Post("/", rs.create)
		manage.Put("/{id}", rs.replace)
		manage.Delete("/{id}", rs.delete)
	})
	return r
}

// ReportTemplateRequest is the body of POST /traeger/report-templates and
// PUT /traeger/report-templates/{id}.
type ReportTemplateRequest struct {
	Name         string                  `json:"name"`
	Sections     []string                `json:"sections"`
	KeyDateMonth int                     `json:"key_date_month"`
	KeyDateDay   int                     `json:"key_date_day"`
	Districts    []ReportDistrictRequest `json:"districts"`
}

// Bind accepts the body; the Owner validates it.
func (req *ReportTemplateRequest) Bind(*http.Request) error { return nil }

func (req *ReportTemplateRequest) input() organizationtenancy.TraegerReportTemplateInput {
	input := organizationtenancy.TraegerReportTemplateInput{
		Name: req.Name, Sections: req.Sections, KeyDateMonth: req.KeyDateMonth, KeyDateDay: req.KeyDateDay,
	}
	if req.Districts != nil {
		input.Districts = make([]organizationtenancy.TraegerReportDistrict, 0, len(req.Districts))
		for _, district := range req.Districts {
			input.Districts = append(input.Districts, organizationtenancy.TraegerReportDistrict(district))
		}
	}
	return input
}

// ReportDistrictRequest assigns a school to a Sozialraum in a request; the
// contract keeps a request type apart from the answer's (ADR 0270).
type ReportDistrictRequest struct {
	SchoolID common.ID `json:"school_id"`
	District string    `json:"district"`
}

func (rs *ReportTemplateResource) list(w http.ResponseWriter, r *http.Request) {
	organizationID, _, ok := session(w, r)
	if !ok {
		return
	}
	templates, err := rs.templates.ReportTemplates(r.Context(), organizationID)
	if err != nil {
		renderReportTemplateError(w, r, err)
		return
	}
	common.Respond(w, r, http.StatusOK, templates, "Report templates retrieved successfully")
}

func (rs *ReportTemplateResource) create(w http.ResponseWriter, r *http.Request) {
	organizationID, accountID, ok := session(w, r)
	if !ok {
		return
	}
	req := &ReportTemplateRequest{}
	if err := render.Bind(r, req); err != nil {
		common.RenderError(w, r, common.ErrorInvalidRequest(err))
		return
	}
	created, err := rs.templates.AddReportTemplate(r.Context(), organizationID, accountID, req.input())
	if err != nil {
		renderReportTemplateError(w, r, err)
		return
	}
	common.Respond(w, r, http.StatusCreated, created, "Report template created successfully")
}

func (rs *ReportTemplateResource) replace(w http.ResponseWriter, r *http.Request) {
	organizationID, accountID, ok := session(w, r)
	if !ok {
		return
	}
	templateID, err := common.ParseIDParam(r, "id")
	if err != nil {
		common.RenderError(w, r, common.ErrorInvalidRequest(err))
		return
	}
	req := &ReportTemplateRequest{}
	if err := render.Bind(r, req); err != nil {
		common.RenderError(w, r, common.ErrorInvalidRequest(err))
		return
	}
	updated, err := rs.templates.ReplaceReportTemplate(r.Context(), organizationID, accountID, templateID, req.input())
	if err != nil {
		renderReportTemplateError(w, r, err)
		return
	}
	common.Respond(w, r, http.StatusOK, updated, "Report template saved successfully")
}

func (rs *ReportTemplateResource) delete(w http.ResponseWriter, r *http.Request) {
	organizationID, accountID, ok := session(w, r)
	if !ok {
		return
	}
	templateID, err := common.ParseIDParam(r, "id")
	if err != nil {
		common.RenderError(w, r, common.ErrorInvalidRequest(err))
		return
	}
	if err := rs.templates.RemoveReportTemplate(r.Context(), organizationID, accountID, templateID); err != nil {
		renderReportTemplateError(w, r, err)
		return
	}
	common.RespondNoContent(w, r)
}

// renderReportTemplateError answers a refused template operation. Every
// refusal is decided before the first write.
func renderReportTemplateError(w http.ResponseWriter, r *http.Request, err error) {
	var fields validation.Errors
	switch {
	case errors.As(err, &fields):
		common.RenderError(w, r, common.ErrorInvalidRequestWithCode(err, common.CodeTraegerReportTemplateInvalid))
	case errors.Is(err, organizationtenancy.ErrTraegerReportTemplateNotFound):
		common.RenderError(w, r, common.ErrorNotFoundWithCode(err, common.CodeTraegerReportTemplateNotFound))
	case errors.Is(err, organizationtenancy.ErrTraegerReportTemplateNameTaken):
		common.RenderError(w, r, common.ErrorConflictWithCode(err, common.CodeTraegerReportTemplateNameTaken))
	default:
		common.RenderError(w, r, common.ErrorInternalServer(err))
	}
}
