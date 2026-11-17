package parentbillinghttp

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/render"
	validation "github.com/go-ozzo/ozzo-validation"

	"github.com/moto-ogs/project-phoenix/api/common"
	capability "github.com/moto-ogs/project-phoenix/modules/parentbilling"
	"github.com/moto-ogs/project-phoenix/tenant"
)

// The numbers of the families from a file (#7356) at
// /traeger/family-children/imports: POST /preview reads a file and answers
// every row, POST / takes over the ready rows of the confirmed preview. The
// file comes as multipart field "file" (.csv or .txt, at most
// capability.MaxImportFileBytes); "mapping" (JSON of
// capability.FamilyChildrenImportMapping), "delimiter" and "fingerprint" are
// optional fields. The file is read in memory and never stored.

func (rs *FamilyChildrenResource) previewImport(w http.ResponseWriter, r *http.Request) {
	rs.importNumbers(w, r, false)
}

func (rs *FamilyChildrenResource) applyImport(w http.ResponseWriter, r *http.Request) {
	rs.importNumbers(w, r, true)
}

func (rs *FamilyChildrenResource) importNumbers(w http.ResponseWriter, r *http.Request, apply bool) {
	reviewer, ok := reviewerOf(w, r)
	if !ok {
		return
	}
	request, err := familyImportRequestOf(w, r)
	if err != nil {
		renderFamilyImportError(w, r, err)
		return
	}
	request.Apply = apply
	result, err := rs.imports.ImportFamilyChildren(r.Context(), reviewer, request)
	if err != nil {
		tenant.MarkRollback(r.Context())
		renderFamilyImportError(w, r, err)
		return
	}
	status := http.StatusOK
	if apply {
		status = http.StatusCreated
	}
	common.Respond(w, r, status, result, "Family children import read successfully")
}

// familyImportRequestOf reads the form: the file (importFileOf) and the
// optional mapping, delimiter and fingerprint. The owner checks the content:
// text with a header row, never a binary file.
func familyImportRequestOf(w http.ResponseWriter, r *http.Request) (capability.FamilyChildrenImportRequest, error) {
	content, _, closeForm, err := importFileOf(w, r)
	defer closeForm()
	if err != nil {
		return capability.FamilyChildrenImportRequest{}, err
	}
	request := capability.FamilyChildrenImportRequest{Content: content, Delimiter: r.FormValue("delimiter"), Fingerprint: r.FormValue("fingerprint")}
	if raw := r.FormValue("mapping"); raw != "" {
		mapping := &capability.FamilyChildrenImportMapping{}
		if err := json.Unmarshal([]byte(raw), mapping); err != nil {
			return capability.FamilyChildrenImportRequest{}, validation.Errors{"mapping": errors.New("is no mapping")}
		}
		request.Mapping = mapping
	}
	return request, nil
}

// familyImportErrorRules answer a refused file. No message repeats a value
// of the file.
var familyImportErrorRules = []struct {
	err    error
	render func(error) render.Renderer
}{
	{capability.ErrImportFileTooLarge, func(err error) render.Renderer {
		return common.ErrorRequestTooLargeWithCode(err, common.CodeParentBillingFamilyChildrenImportFileTooLarge)
	}},
	{capability.ErrImportFileInvalid, func(err error) render.Renderer {
		return common.ErrorInvalidRequestWithCode(err, common.CodeParentBillingFamilyChildrenImportFileInvalid)
	}},
	{errImportFileType, func(err error) render.Renderer {
		return common.ErrorInvalidRequestWithCode(err, common.CodeParentBillingFamilyChildrenImportFileInvalid)
	}},
	{capability.ErrImportChanged, func(err error) render.Renderer {
		return common.ErrorConflictWithCode(err, common.CodeParentBillingFamilyChildrenImportChanged)
	}},
}

// renderFamilyImportError answers a refused import: the file, the changed
// preview, a mapping that names no column, else as the list of the numbers.
func renderFamilyImportError(w http.ResponseWriter, r *http.Request, err error) {
	for _, rule := range familyImportErrorRules {
		if errors.Is(err, rule.err) {
			common.RenderError(w, r, rule.render(err))
			return
		}
	}
	var fields validation.Errors
	if errors.As(err, &fields) {
		common.RenderError(w, r, common.ErrorInvalidRequestWithCode(err, common.CodeParentBillingFamilyChildrenImportMappingInvalid))
		return
	}
	renderFamilyChildrenError(w, r, err)
}
