package parentbillinghttp

import (
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/render"
	validation "github.com/go-ozzo/ozzo-validation"

	"github.com/moto-ogs/project-phoenix/api/common"
	capability "github.com/moto-ogs/project-phoenix/modules/parentbilling"
	"github.com/moto-ogs/project-phoenix/tenant"
)

// FamilyChildrenResource serves the children of the families (#5918) at
// /traeger/family-children: the list, the confirmation of a number for the
// family of a contract, its removal and the numbers from a file (#7356). Every route sits behind the Träger
// session, needs the Träger right "Abrechnung" and runs in the Träger
// transaction of the session's Träger. A family is named by one of its
// contracts, so no address travels in a path.
type FamilyChildrenResource struct {
	office         capability.FamilyChildrenOffice
	imports        capability.FamilyChildrenImports
	requireBilling common.Middleware
	lists          common.ListRenderer
}

// NewFamilyChildrenResource builds the resource.
func NewFamilyChildrenResource(office capability.FamilyChildrenOffice, imports capability.FamilyChildrenImports,
	requireBilling common.Middleware, lists common.ListRenderer) *FamilyChildrenResource {
	if office == nil || imports == nil || requireBilling == nil || lists == nil {
		panic("parent billing http: the family children, their import, the right check and the list export are required")
	}
	return &FamilyChildrenResource{office: office, imports: imports, requireBilling: requireBilling, lists: lists}
}

// Router returns the routes mounted at /traeger/family-children.
func (rs *FamilyChildrenResource) Router(protectedTraegerRoutes func(chi.Router, func(chi.Router, common.Middleware))) chi.Router {
	r := chi.NewRouter()
	r.Use(render.SetContentType(render.ContentTypeJSON))
	protectedTraegerRoutes(r, func(r chi.Router, withTx common.Middleware) {
		billing := r.With(rs.requireBilling, withTx)
		billing.Get("/", rs.list)
		billing.Get("/export", rs.exportList)
		billing.Put("/", rs.confirm)
		billing.Delete("/{contractId}", rs.remove)
		billing.Post("/imports/preview", rs.previewImport)
		billing.Post("/imports", rs.applyImport)
	})
	return r
}

// FamilyChildrenRequest is the body of PUT /traeger/family-children.
type FamilyChildrenRequest struct {
	capability.FamilyChildrenInput
}

// Bind accepts the body; the Owner validates it.
func (req *FamilyChildrenRequest) Bind(*http.Request) error { return nil }

// list answers the families; the read is recorded, so a failure rolls it
// back with the rest.
func (rs *FamilyChildrenResource) list(w http.ResponseWriter, r *http.Request) {
	reviewer, ok := reviewerOf(w, r)
	if !ok {
		return
	}
	set, err := rs.office.FamilyChildren(r.Context(), reviewer)
	if err != nil {
		tenant.MarkRollback(r.Context())
		renderFamilyChildrenError(w, r, err)
		return
	}
	common.Respond(w, r, http.StatusOK, set, "Family children retrieved successfully")
}

func (rs *FamilyChildrenResource) confirm(w http.ResponseWriter, r *http.Request) {
	reviewer, ok := reviewerOf(w, r)
	if !ok {
		return
	}
	req := &FamilyChildrenRequest{}
	if err := render.Bind(r, req); err != nil {
		common.RenderError(w, r, common.ErrorInvalidRequestWithCode(err, common.CodeParentBillingFamilyChildrenInvalid))
		return
	}
	set, err := rs.office.ConfirmFamilyChildren(r.Context(), reviewer, req.FamilyChildrenInput)
	if err != nil {
		tenant.MarkRollback(r.Context())
		renderFamilyChildrenError(w, r, err)
		return
	}
	common.Respond(w, r, http.StatusOK, set, "Family children confirmed successfully")
}

func (rs *FamilyChildrenResource) remove(w http.ResponseWriter, r *http.Request) {
	reviewer, ok := reviewerOf(w, r)
	if !ok {
		return
	}
	contractID, err := common.ParseIDParam(r, "contractId")
	if err != nil {
		common.RenderError(w, r, common.ErrorInvalidRequest(err))
		return
	}
	set, err := rs.office.RemoveFamilyChildren(r.Context(), reviewer, contractID)
	if err != nil {
		tenant.MarkRollback(r.Context())
		renderFamilyChildrenError(w, r, err)
		return
	}
	common.Respond(w, r, http.StatusOK, set, "Family children removed successfully")
}

// renderFamilyChildrenError answers a refused number.
func renderFamilyChildrenError(w http.ResponseWriter, r *http.Request, err error) {
	var fields validation.Errors
	switch {
	case errors.As(err, &fields):
		common.RenderError(w, r, common.ErrorInvalidRequestWithCode(err, common.CodeParentBillingFamilyChildrenInvalid))
	case errors.Is(err, capability.ErrFamilyChildrenNotFound):
		common.RenderError(w, r, common.ErrorNotFoundWithCode(err, common.CodeParentBillingFamilyChildrenNotFound))
	default:
		common.RenderError(w, r, common.ErrorInternalServer(err))
	}
}
