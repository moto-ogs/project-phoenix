package carecontracthttp

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/render"

	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/modules/carecontract"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

// The link of imported contracts to the child records of their schools in
// the Träger-Portal (#7760, ADR 0307). A file takes
// the form of the import: the file, the columns as JSON and, for the run, the
// fingerprint of the confirmed preview. A single contract takes a JSON body.
// The owner opens its units itself, so the routes carry no transaction.

// ChildLinkResource serves /traeger/contract-child-links.
type ChildLinkResource struct {
	links           carecontract.ContractChildLinks
	requireContract common.Middleware
}

func NewChildLinkResource(links carecontract.ContractChildLinks, requireContract common.Middleware) *ChildLinkResource {
	if links == nil || requireContract == nil {
		panic("care contract http: the links and the right check are required")
	}
	return &ChildLinkResource{links: links, requireContract: requireContract}
}

// Router returns the routes mounted at /traeger/contract-child-links.
func (rs *ChildLinkResource) Router(protectedTraegerRoutes func(chi.Router, func(chi.Router, common.Middleware))) chi.Router {
	r := chi.NewRouter()
	r.Use(render.SetContentType(render.ContentTypeJSON))
	protectedTraegerRoutes(r, func(r chi.Router, _ common.Middleware) {
		open := r.With(rs.requireContract)
		open.Post("/", rs.applyFile)
		open.Post("/preview", rs.previewFile)
		open.Post("/{contractId}/preview", rs.previewOne)
		open.Put("/{contractId}", rs.linkOne)
		open.Delete("/{contractId}", rs.unlink)
	})
	return r
}

// ChildLinkPreviewRequest names the child record one contract would be
// linked to.
type ChildLinkPreviewRequest struct {
	StudentID ident.ID `json:"student_id"`
}

// Bind accepts the body; the owner checks the identifier.
func (req *ChildLinkPreviewRequest) Bind(*http.Request) error { return nil }

// ChildLinkRequest links one contract to a child record. AcceptDifference
// confirms that a child record named or born otherwise is the contract's
// child; Fingerprint is the one of the previewed row the office saw.
type ChildLinkRequest struct {
	StudentID        ident.ID `json:"student_id"`
	AcceptDifference bool     `json:"accept_difference"`
	Fingerprint      string   `json:"fingerprint"`
}

// Bind accepts the body; the owner checks the identifier.
func (req *ChildLinkRequest) Bind(*http.Request) error { return nil }

func (rs *ChildLinkResource) previewFile(w http.ResponseWriter, r *http.Request) {
	rs.lookAtFile(w, r, false)
}

func (rs *ChildLinkResource) applyFile(w http.ResponseWriter, r *http.Request) {
	rs.lookAtFile(w, r, true)
}

func (rs *ChildLinkResource) lookAtFile(w http.ResponseWriter, r *http.Request, apply bool) {
	reviewer, ok := reviewerOf(w, r)
	if !ok {
		return
	}
	request, err := childLinkRequestOf(w, r)
	if err != nil {
		renderChildLinkError(w, r, err)
		return
	}
	request.Apply = apply
	result, err := rs.links.LinkChildren(r.Context(), reviewer, request)
	if err != nil {
		renderChildLinkError(w, r, err)
		return
	}
	status := http.StatusOK
	if apply {
		status = http.StatusCreated
	}
	common.Respond(w, r, status, result, "Contract child links read")
}

// childLinkRequestOf reads the upload like the import and the columns.
func childLinkRequestOf(w http.ResponseWriter, r *http.Request) (carecontract.ChildLinkRequest, error) {
	upload, err := readImportUpload(w, r)
	if err != nil {
		return carecontract.ChildLinkRequest{}, err
	}
	request := carecontract.ChildLinkRequest{Content: upload.content, FileName: upload.fileName,
		Delimiter: r.FormValue("delimiter"), Fingerprint: r.FormValue("fingerprint")}
	if raw := r.FormValue("columns"); raw != "" {
		var columns carecontract.ChildLinkColumns
		if err := json.Unmarshal([]byte(raw), &columns); err != nil {
			return carecontract.ChildLinkRequest{}, &carecontract.ValidationError{Fields: map[string]string{"columns": "invalid"}}
		}
		request.Columns = &columns
	}
	return request, nil
}

func (rs *ChildLinkResource) previewOne(w http.ResponseWriter, r *http.Request) {
	req := &ChildLinkPreviewRequest{}
	rs.linkOneWith(w, r, req, func() carecontract.ChildLinkInput { return carecontract.ChildLinkInput{StudentID: req.StudentID} })
}

func (rs *ChildLinkResource) linkOne(w http.ResponseWriter, r *http.Request) {
	req := &ChildLinkRequest{}
	rs.linkOneWith(w, r, req, func() carecontract.ChildLinkInput {
		return carecontract.ChildLinkInput{StudentID: req.StudentID, Apply: true, AcceptDifference: req.AcceptDifference,
			Fingerprint: req.Fingerprint}
	})
}

// linkOneWith binds body and answers the link input reads from it.
func (rs *ChildLinkResource) linkOneWith(w http.ResponseWriter, r *http.Request, body render.Binder, input func() carecontract.ChildLinkInput) {
	reviewer, contractID, ok := childLinkContract(w, r)
	if !ok {
		return
	}
	if err := render.Bind(r, body); err != nil {
		common.RenderError(w, r, common.ErrorInvalidRequest(err))
		return
	}
	row, err := rs.links.LinkChild(r.Context(), reviewer, contractID, input())
	if err != nil {
		renderChildLinkError(w, r, err)
		return
	}
	common.Respond(w, r, http.StatusOK, row, "Contract child link read")
}

// unlink takes the child record the query names, the one the office saw,
// off the contract.
func (rs *ChildLinkResource) unlink(w http.ResponseWriter, r *http.Request) {
	reviewer, contractID, ok := childLinkContract(w, r)
	if !ok {
		return
	}
	studentID, err := optionalID(r, "student_id")
	if err == nil && studentID == 0 {
		err = errors.New("student_id is required")
	}
	if err != nil {
		common.RenderError(w, r, common.ErrorInvalidRequest(err))
		return
	}
	if err := rs.links.UnlinkChild(r.Context(), reviewer, contractID, studentID); err != nil {
		renderChildLinkError(w, r, err)
		return
	}
	common.RespondNoContent(w, r)
}

func childLinkContract(w http.ResponseWriter, r *http.Request) (carecontract.Reviewer, int64, bool) {
	reviewer, ok := reviewerOf(w, r)
	if !ok {
		return carecontract.Reviewer{}, 0, false
	}
	id, err := common.ParseIDParam(r, "contractId")
	if err != nil {
		common.RenderError(w, r, common.ErrorInvalidRequest(err))
		return carecontract.Reviewer{}, 0, false
	}
	return reviewer, id, true
}

var childLinkErrorRules = []struct {
	err    error
	render func(error) render.Renderer
}{
	{carecontract.ErrChildLinkChanged, func(err error) render.Renderer {
		return common.ErrorConflictWithCode(err, common.CodeCareContractChildLinkChanged)
	}},
	{carecontract.ErrChildLinkRefused, func(err error) render.Renderer {
		return common.ErrorConflictWithCode(err, common.CodeCareContractChildLinkRefused)
	}},
	{carecontract.ErrChildLinkNotImported, func(err error) render.Renderer {
		return common.ErrorConflictWithCode(err, common.CodeCareContractChildLinkNotImported)
	}},
}

// renderChildLinkError renders the failures of the link, then those of the
// file the import shares, then the general ones (ErrContractNotFound).
func renderChildLinkError(w http.ResponseWriter, r *http.Request, err error) {
	for _, rule := range childLinkErrorRules {
		if errors.Is(err, rule.err) {
			common.RenderError(w, r, rule.render(err))
			return
		}
	}
	renderImportError(w, r, err)
}
