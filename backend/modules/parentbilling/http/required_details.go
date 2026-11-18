package parentbillinghttp

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/render"

	"github.com/moto-ogs/project-phoenix/api/common"
	capability "github.com/moto-ogs/project-phoenix/modules/parentbilling"
)

// RequiredDetailsResource serves the details the Träger still has to enter
// (#7177) at /traeger/required-details. Every member of the Träger reads
// it, without a right of its own: the answer names only which details are
// missing, never their values, and tells whom to ask.
type RequiredDetailsResource struct {
	check capability.RequiredDetailsCheck
}

// NewRequiredDetailsResource builds the resource.
func NewRequiredDetailsResource(check capability.RequiredDetailsCheck) *RequiredDetailsResource {
	if check == nil {
		panic("parent billing http: the required details check is required")
	}
	return &RequiredDetailsResource{check: check}
}

// Router returns the routes mounted at /traeger/required-details.
func (rs *RequiredDetailsResource) Router(protectedTraegerRoutes func(chi.Router, func(chi.Router, common.Middleware))) chi.Router {
	r := chi.NewRouter()
	r.Use(render.SetContentType(render.ContentTypeJSON))
	protectedTraegerRoutes(r, func(r chi.Router, withTx common.Middleware) {
		r.With(withTx).Get("/", rs.requiredDetails)
	})
	return r
}

func (rs *RequiredDetailsResource) requiredDetails(w http.ResponseWriter, r *http.Request) {
	reviewer, ok := reviewerOf(w, r)
	if !ok {
		return
	}
	details, err := rs.check.RequiredDetails(r.Context(), reviewer.OrganizationID)
	if err != nil {
		common.RenderError(w, r, common.ErrorInternalServer(err))
		return
	}
	common.Respond(w, r, http.StatusOK, details, "Required details retrieved successfully")
}
