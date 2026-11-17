package parentbillinghttp

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"path/filepath"
	"strings"

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
// optional fields. The file is read in memory and never stored. A refused
// file answers with the codes of the mandate import, whose texts name no
// mandate.

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

// familyImportRequestOf reads the form: the file within the size limit and
// with a CSV name, and the optional mapping, delimiter and fingerprint. The
// owner checks the content: text with a header row, never a binary file.
func familyImportRequestOf(w http.ResponseWriter, r *http.Request) (capability.FamilyChildrenImportRequest, error) {
	none := capability.FamilyChildrenImportRequest{}
	r.Body = http.MaxBytesReader(w, r.Body, capability.MaxImportFileBytes+importFormOverhead)
	if err := r.ParseMultipartForm(capability.MaxImportFileBytes + importFormOverhead); err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			return none, capability.ErrImportFileTooLarge
		}
		return none, capability.ErrImportFileInvalid
	}
	defer func() { _ = r.MultipartForm.RemoveAll() }()
	file, header, err := r.FormFile("file")
	if err != nil {
		return none, capability.ErrImportFileInvalid
	}
	defer func() { _ = file.Close() }()
	if !containsExtension(strings.ToLower(filepath.Ext(header.Filename))) {
		return none, errImportFileType
	}
	content, err := io.ReadAll(io.LimitReader(file, capability.MaxImportFileBytes+1))
	if err != nil {
		return none, capability.ErrImportFileInvalid
	}
	request := capability.FamilyChildrenImportRequest{Content: content, Delimiter: r.FormValue("delimiter"), Fingerprint: r.FormValue("fingerprint")}
	if raw := r.FormValue("mapping"); raw != "" {
		mapping := &capability.FamilyChildrenImportMapping{}
		if err := json.Unmarshal([]byte(raw), mapping); err != nil {
			return none, validation.Errors{"mapping": errors.New("is no mapping")}
		}
		request.Mapping = mapping
	}
	return request, nil
}

// renderFamilyImportError answers a refused import. No message repeats a
// value of the file.
func renderFamilyImportError(w http.ResponseWriter, r *http.Request, err error) {
	var fields validation.Errors
	switch {
	case errors.Is(err, capability.ErrImportFileTooLarge):
		common.RenderError(w, r, common.ErrorRequestTooLargeWithCode(err, common.CodeParentBillingSepaImportFileTooLarge))
	case errors.Is(err, capability.ErrImportFileInvalid), errors.Is(err, errImportFileType):
		common.RenderError(w, r, common.ErrorInvalidRequestWithCode(err, common.CodeParentBillingSepaImportFileInvalid))
	case errors.Is(err, capability.ErrImportChanged):
		common.RenderError(w, r, common.ErrorConflictWithCode(err, common.CodeParentBillingSepaImportChanged))
	case errors.As(err, &fields):
		common.RenderError(w, r, common.ErrorInvalidRequestWithCode(err, common.CodeParentBillingSepaImportMappingInvalid))
	default:
		renderFamilyChildrenError(w, r, err)
	}
}
