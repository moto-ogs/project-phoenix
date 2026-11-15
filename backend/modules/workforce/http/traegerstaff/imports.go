package traegerstaff

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"path/filepath"
	"slices"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/render"

	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/modules/workforce"
)

// The Personal-Import (#4724) at /traeger/staff-record-imports: POST
// /preview reads a file and answers every row, POST / takes over the new
// and complete rows, GET / lists the imports. The file comes as multipart
// field "file" (.csv or .txt, at most workforce.MaxStaffImportFileBytes);
// the owner refuses content that is no text. "mapping" (JSON of
// workforce.StaffImportMapping), "delimiter" and "fingerprint" are optional
// fields. The file is read in memory and never stored; no answer and no
// error repeats a bank or tax value.

// importFormOverhead is the room the multipart envelope and the other
// fields of the form get beside the file.
const importFormOverhead = 64 << 10

// importFileExtensions are the names a CSV export of an office program has.
var importFileExtensions = []string{".csv", ".txt"}

// errImportFileType reports a file whose name is no CSV export.
var errImportFileType = errors.New("the import file must be a .csv or .txt file")

// ImportsResource serves the Personal-Import of the session's Träger
// behind the Träger right „Personal“.
type ImportsResource struct {
	imports      workforce.TraegerStaffImports
	requireStaff common.Middleware
}

// NewImportsResource builds the resource; the root binds requireStaff to
// the Träger right traeger_staff:manage.
func NewImportsResource(imports workforce.TraegerStaffImports, requireStaff common.Middleware) *ImportsResource {
	if imports == nil || requireStaff == nil {
		panic("workforce traeger staff imports: the import and the right check are required")
	}
	return &ImportsResource{imports: imports, requireStaff: requireStaff}
}

// TraegerRouter returns the routes mounted at /traeger/staff-record-imports.
func (rs *ImportsResource) TraegerRouter(protectedTraegerRoutes func(chi.Router, func(chi.Router, common.Middleware))) chi.Router {
	r := chi.NewRouter()
	r.Use(render.SetContentType(render.ContentTypeJSON))
	protectedTraegerRoutes(r, func(r chi.Router, _ common.Middleware) {
		staff := r.With(rs.requireStaff)
		staff.Get("/", rs.log)
		staff.Post("/", rs.apply)
		staff.Post("/preview", rs.preview)
	})
	return r
}

func (rs *ImportsResource) preview(w http.ResponseWriter, r *http.Request) {
	rs.importStaff(w, r, false)
}

func (rs *ImportsResource) apply(w http.ResponseWriter, r *http.Request) {
	rs.importStaff(w, r, true)
}

func (rs *ImportsResource) importStaff(w http.ResponseWriter, r *http.Request, apply bool) {
	session, ok := actor(w, r)
	if !ok {
		return
	}
	request, err := importRequestOf(w, r)
	if err != nil {
		renderImportError(w, r, err)
		return
	}
	request.Apply = apply
	result, err := rs.imports.ImportStaff(r.Context(), session, request)
	if err != nil {
		renderImportError(w, r, err)
		return
	}
	status := http.StatusOK
	if apply {
		status = http.StatusCreated
	}
	common.Respond(w, r, status, result, "Staff import read successfully")
}

func (rs *ImportsResource) log(w http.ResponseWriter, r *http.Request) {
	session, ok := actor(w, r)
	if !ok {
		return
	}
	entries, err := rs.imports.StaffImportLog(r.Context(), session)
	if err != nil {
		renderError(w, r, err)
		return
	}
	common.Respond(w, r, http.StatusOK, entries, "Staff imports retrieved successfully")
}

// importRequestOf reads the form: the file within the size limit and with
// a CSV name, and the optional mapping, delimiter and fingerprint.
func importRequestOf(w http.ResponseWriter, r *http.Request) (workforce.StaffImportRequest, error) {
	r.Body = http.MaxBytesReader(w, r.Body, workforce.MaxStaffImportFileBytes+importFormOverhead)
	if err := r.ParseMultipartForm(workforce.MaxStaffImportFileBytes + importFormOverhead); err != nil {
		if _, tooLarge := errors.AsType[*http.MaxBytesError](err); tooLarge {
			return workforce.StaffImportRequest{}, workforce.ErrStaffImportFileTooLarge
		}
		return workforce.StaffImportRequest{}, workforce.ErrStaffImportFileInvalid
	}
	// The limit keeps the whole form in memory; RemoveAll drops any part the
	// parser still spilled to disk, so no copy of the file stays.
	defer func() { _ = r.MultipartForm.RemoveAll() }()
	file, header, err := r.FormFile("file")
	if err != nil {
		return workforce.StaffImportRequest{}, workforce.ErrStaffImportFileInvalid
	}
	defer func() { _ = file.Close() }()
	if !slices.Contains(importFileExtensions, strings.ToLower(filepath.Ext(header.Filename))) {
		return workforce.StaffImportRequest{}, errImportFileType
	}
	content, err := io.ReadAll(io.LimitReader(file, workforce.MaxStaffImportFileBytes+1))
	if err != nil {
		return workforce.StaffImportRequest{}, workforce.ErrStaffImportFileInvalid
	}
	if len(content) > workforce.MaxStaffImportFileBytes {
		return workforce.StaffImportRequest{}, workforce.ErrStaffImportFileTooLarge
	}
	request := workforce.StaffImportRequest{Content: content, FileName: header.Filename, Delimiter: r.FormValue("delimiter"),
		Fingerprint: r.FormValue("fingerprint")}
	if raw := r.FormValue("mapping"); raw != "" {
		mapping := &workforce.StaffImportMapping{}
		if err := json.Unmarshal([]byte(raw), mapping); err != nil {
			return workforce.StaffImportRequest{}, &workforce.StaffImportMappingError{Field: "mapping", Reason: "is no mapping"}
		}
		request.Mapping = mapping
	}
	return request, nil
}

// renderImportError answers a refused import. No message repeats a value
// of the file.
func renderImportError(w http.ResponseWriter, r *http.Request, err error) {
	if mapping, ok := errors.AsType[*workforce.StaffImportMappingError](err); ok {
		common.RenderError(w, r, common.ErrorInvalidOnField(err, common.CodeWorkforceTraegerStaffImportMappingInvalid, mapping.Field))
		return
	}
	common.RenderError(w, r, importErrors(err))
}

var importErrors = common.RulesRenderer([]common.ErrorRule{
	{Target: workforce.ErrStaffImportFileTooLarge, Render: coded(common.ErrorRequestTooLargeWithCode, common.CodeWorkforceTraegerStaffImportFileTooLarge)},
	{Target: workforce.ErrStaffImportFileInvalid, Render: coded(common.ErrorInvalidRequestWithCode, common.CodeWorkforceTraegerStaffImportFileInvalid)},
	{Target: errImportFileType, Render: coded(common.ErrorInvalidRequestWithCode, common.CodeWorkforceTraegerStaffImportFileInvalid)},
	{Target: workforce.ErrStaffImportChanged, Render: coded(common.ErrorConflictWithCode, common.CodeWorkforceTraegerStaffImportChanged)},
	{Target: workforce.ErrTraegerStaffNotReleased, Render: coded(common.ErrorConflictWithCode, common.CodeWorkforceTraegerStaffNotReleased)},
}, common.ErrorInternalServer)
