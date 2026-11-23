// Package contractenrollmenthttp serves the enrollment of the children of
// imported care contracts in the Träger-Portal (#7760, ADR 0309 section 4).
// The workflow opens the Träger transaction and the school's tenant
// transaction itself, one after the other, so the routes carry no
// transaction.
package contractenrollmenthttp

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/render"

	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/modules/carecontract"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
	"github.com/moto-ogs/project-phoenix/workflows/contractenrollment"
)

// Resource serves /traeger/contract-enrollments.
type Resource struct {
	enrollments     contractenrollment.Enrollments
	requireContract common.Middleware
}

// NewResource builds the resource; both collaborators are required.
func NewResource(enrollments contractenrollment.Enrollments, requireContract common.Middleware) *Resource {
	if enrollments == nil || requireContract == nil {
		panic("contract enrollment http: the workflow and the right check are required")
	}
	return &Resource{enrollments: enrollments, requireContract: requireContract}
}

// Router returns the routes mounted at /traeger/contract-enrollments.
func (rs *Resource) Router(protectedTraegerRoutes func(chi.Router, func(chi.Router, common.Middleware))) chi.Router {
	r := chi.NewRouter()
	r.Use(render.SetContentType(render.ContentTypeJSON))
	protectedTraegerRoutes(r, func(r chi.Router, _ common.Middleware) {
		open := r.With(rs.requireContract)
		open.Post("/preview", rs.preview)
		open.Post("/", rs.run)
		open.Delete("/{contractId}", rs.unbind)
	})
	return r
}

// RouteContracts registers the routes, with patterns relative to
// /traeger/contract-enrollments.
func RouteContracts() []common.RouteContract {
	portals := []common.PortalScope{common.PortalTraeger}
	return []common.RouteContract{
		{Method: "POST", Pattern: "/preview", Portals: portals, Request: ContractEnrollmentPreviewRequest{}, Response: contractenrollment.EnrollmentPreview{},
			NoCommit: "the preview shows what the run would do for the children of the imported contracts and enrolls nobody"},
		{Method: "POST", Pattern: "/", Portals: portals, Request: ContractEnrollmentRunRequest{}, Response: contractenrollment.EnrollmentRun{}},
		{Method: "DELETE", Pattern: "/{contractId}", Portals: portals, NoData: true,
			Query: []common.QueryParam{{Name: "request_child_id", Kind: common.QueryID}}},
	}
}

// ContractEnrollmentPreviewRequest names the school whose imported contracts are previewed.
type ContractEnrollmentPreviewRequest struct {
	SchoolID ident.ID `json:"school_id"`
}

// Bind requires the school.
func (req *ContractEnrollmentPreviewRequest) Bind(*http.Request) error {
	if req.SchoolID <= 0 {
		return errors.New("school_id is required")
	}
	return nil
}

// ContractEnrollmentRunRequest confirms the preview of one school by its fingerprint.
type ContractEnrollmentRunRequest struct {
	SchoolID    ident.ID `json:"school_id"`
	Fingerprint string   `json:"fingerprint"`
}

// Bind requires the school and the fingerprint.
func (req *ContractEnrollmentRunRequest) Bind(*http.Request) error {
	if req.SchoolID <= 0 {
		return errors.New("school_id is required")
	}
	if req.Fingerprint == "" {
		return errors.New("fingerprint is required")
	}
	return nil
}

func (rs *Resource) preview(w http.ResponseWriter, r *http.Request) {
	actor, ok := actorOf(w, r)
	if !ok {
		return
	}
	req := &ContractEnrollmentPreviewRequest{}
	if err := render.Bind(r, req); err != nil {
		common.RenderError(w, r, common.ErrorInvalidRequest(err))
		return
	}
	preview, err := rs.enrollments.Preview(r.Context(), actor, req.SchoolID.Int64())
	if err != nil {
		common.RenderError(w, r, renderFailure(err))
		return
	}
	common.Respond(w, r, http.StatusOK, preview, "Contract enrollments previewed")
}

func (rs *Resource) run(w http.ResponseWriter, r *http.Request) {
	actor, ok := actorOf(w, r)
	if !ok {
		return
	}
	req := &ContractEnrollmentRunRequest{}
	if err := render.Bind(r, req); err != nil {
		common.RenderError(w, r, common.ErrorInvalidRequest(err))
		return
	}
	run, err := rs.enrollments.Run(r.Context(), actor, req.SchoolID.Int64(), req.Fingerprint)
	if err != nil {
		common.RenderError(w, r, renderFailure(err))
		return
	}
	common.Respond(w, r, http.StatusOK, run, "Contract children enrolled")
}

// unbind takes the application child the query names, the one the office
// saw, off the contract.
func (rs *Resource) unbind(w http.ResponseWriter, r *http.Request) {
	actor, ok := actorOf(w, r)
	if !ok {
		return
	}
	contractID, err := common.ParseIDParam(r, "contractId")
	if err != nil {
		common.RenderError(w, r, common.ErrorInvalidRequest(err))
		return
	}
	requestChildID, err := strconv.ParseInt(r.URL.Query().Get("request_child_id"), 10, 64)
	if err != nil || requestChildID <= 0 {
		common.RenderError(w, r, common.ErrorInvalidRequest(errors.New("request_child_id is required")))
		return
	}
	if err := rs.enrollments.Unbind(r.Context(), actor, contractID, requestChildID); err != nil {
		common.RenderError(w, r, renderFailure(err))
		return
	}
	common.RespondNoContent(w, r)
}

// actorOf is the Träger office of the session; the Träger never comes from
// the request.
func actorOf(w http.ResponseWriter, r *http.Request) (contractenrollment.Actor, bool) {
	principal, err := common.CurrentPrincipal(r.Context())
	if err != nil || principal.OrganizationID() <= 0 || principal.AccountID() <= 0 {
		common.RenderError(w, r, common.ErrorUnauthorized(common.ErrUnauthorized))
		return contractenrollment.Actor{}, false
	}
	return contractenrollment.Actor{OrganizationID: principal.OrganizationID(), AccountID: principal.AccountID()}, true
}

var errorRules = []common.ErrorRule{
	{Target: contractenrollment.ErrPreviewChanged, Render: conflict(common.CodeCareContractEnrollmentPreviewChanged)},
	// An application child that got a contract between the school's
	// enrollment and the binding: the next preview shows the row as it is.
	{Target: carecontract.ErrContractExists, Render: conflict(common.CodeCareContractEnrollmentPreviewChanged)},
	{Target: carecontract.ErrBindingChanged, Render: conflict(common.CodeCareContractEnrollmentBindingChanged)},
	{Target: carecontract.ErrSchoolOutsideTraeger, Render: func(err error) render.Renderer {
		return common.ErrorForbiddenWithCode(err, common.CodeCareContractSchoolOutsideTraeger)
	}},
	{Target: carecontract.ErrContractNotFound, Render: func(err error) render.Renderer {
		return common.ErrorNotFoundWithCode(err, common.CodeCareContractContractNotFound)
	}},
}

var renderFailure = common.RulesRenderer(errorRules, common.ErrorInternalServer)

func conflict(code string) func(error) render.Renderer {
	return func(err error) render.Renderer { return common.ErrorConflictWithCode(err, code) }
}
