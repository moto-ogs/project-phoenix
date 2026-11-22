package carecontracthttp

import (
	"errors"
	"io"
	"net/http"
	"path/filepath"
	"slices"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/render"

	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/modules/carecontract"
)

// The correction of contracts from an import in the Träger-Portal (#7767).
// The office downloads the list of those contracts, fills in what the
// original documents prove and loads it up: the preview and the correction
// take the same multipart form, the file and, for the correction, the
// fingerprint of the confirmed preview. The owner opens its units itself:
// the Träger transaction and the access log of the schools, so the routes
// carry no transaction.

// correctionListFilename names the list to download.
const correctionListFilename = "vertragsangaben-nachpflegen"

// CorrectionResource serves /traeger/contract-corrections.
type CorrectionResource struct {
	corrections     carecontract.ContractCorrections
	requireContract common.Middleware
	lists           common.ListRenderer
}

// NewCorrectionResource builds the resource; lists renders the list to
// download.
func NewCorrectionResource(corrections carecontract.ContractCorrections, requireContract common.Middleware, lists common.ListRenderer) *CorrectionResource {
	if corrections == nil || requireContract == nil || lists == nil {
		panic("care contract http: the corrections, the right check and the list renderer are required")
	}
	return &CorrectionResource{corrections: corrections, requireContract: requireContract, lists: lists}
}

// Router returns the routes mounted at /traeger/contract-corrections.
func (rs *CorrectionResource) Router(protectedTraegerRoutes func(chi.Router, func(chi.Router, common.Middleware))) chi.Router {
	r := chi.NewRouter()
	r.Use(render.SetContentType(render.ContentTypeJSON))
	protectedTraegerRoutes(r, func(r chi.Router, _ common.Middleware) {
		open := r.With(rs.requireContract)
		open.Get("/", rs.log)
		open.Get("/list", rs.list)
		open.Post("/", rs.apply)
		open.Post("/preview", rs.preview)
	})
	return r
}

func (rs *CorrectionResource) preview(w http.ResponseWriter, r *http.Request) { rs.look(w, r, false) }

func (rs *CorrectionResource) apply(w http.ResponseWriter, r *http.Request) { rs.look(w, r, true) }

func (rs *CorrectionResource) look(w http.ResponseWriter, r *http.Request, apply bool) {
	reviewer, ok := reviewerOf(w, r)
	if !ok {
		return
	}
	request, err := correctionRequestOf(w, r)
	if err != nil {
		renderCorrectionError(w, r, err)
		return
	}
	request.Apply = apply
	run, err := rs.corrections.CorrectContracts(r.Context(), reviewer, request)
	if err != nil {
		renderCorrectionError(w, r, err)
		return
	}
	common.Respond(w, r, http.StatusOK, run, "Contract correction read")
}

func (rs *CorrectionResource) log(w http.ResponseWriter, r *http.Request) {
	reviewer, ok := reviewerOf(w, r)
	if !ok {
		return
	}
	entries, err := rs.corrections.ContractCorrectionLog(r.Context(), reviewer)
	if err != nil {
		renderError(w, r, err)
		return
	}
	common.Respond(w, r, http.StatusOK, entries, "Contract corrections retrieved")
}

// list answers GET /traeger/contract-corrections/list: every contract from
// an import as the CSV file the office fills in and loads up again. The read
// is written to the access log of each school.
func (rs *CorrectionResource) list(w http.ResponseWriter, r *http.Request) {
	reviewer, ok := reviewerOf(w, r)
	if !ok {
		return
	}
	sheet, err := rs.corrections.ContractCorrectionList(r.Context(), reviewer)
	if err != nil {
		renderError(w, r, err)
		return
	}
	columns := make([]common.ListColumn, len(sheet.Headers))
	for n, header := range sheet.Headers {
		columns[n] = common.ListColumn{ID: strconv.Itoa(n), Label: header}
	}
	common.WriteList(w, r, rs.lists, common.ListFormatCSV, common.ListTable{
		Title: "Vertragsangaben nachpflegen", Columns: columns, Rows: sheet.Rows,
		Footer: common.ListPersonalDataFooter, Filename: correctionListFilename,
	})
}

// correctionRequestOf reads the upload: a file of at most
// MaxContractImportFileBytes named .csv or .txt, and the fingerprint. The
// owner checks the content: text with a header row, never a binary file.
func correctionRequestOf(w http.ResponseWriter, r *http.Request) (carecontract.ContractCorrectionRequest, error) {
	limit := int64(carecontract.MaxContractImportFileBytes + importFormOverhead)
	r.Body = http.MaxBytesReader(w, r.Body, limit)
	if err := r.ParseMultipartForm(limit); err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			return carecontract.ContractCorrectionRequest{}, carecontract.ErrContractImportFileTooLarge
		}
		return carecontract.ContractCorrectionRequest{}, carecontract.ErrContractImportFileInvalid
	}
	defer func() { _ = r.MultipartForm.RemoveAll() }()
	file, header, err := r.FormFile("file")
	if err != nil {
		return carecontract.ContractCorrectionRequest{}, carecontract.ErrContractImportFileInvalid
	}
	defer func() { _ = file.Close() }()
	if !slices.Contains(importExtensions, strings.ToLower(filepath.Ext(header.Filename))) {
		return carecontract.ContractCorrectionRequest{}, errImportFileType
	}
	content, err := io.ReadAll(io.LimitReader(file, carecontract.MaxContractImportFileBytes+1))
	if err != nil {
		return carecontract.ContractCorrectionRequest{}, carecontract.ErrContractImportFileInvalid
	}
	return carecontract.ContractCorrectionRequest{Content: content, FileName: header.Filename, Fingerprint: r.FormValue("fingerprint")}, nil
}

// renderCorrectionError answers a correction that differs from its preview
// as an import that does: the office loads the preview again. A file that
// cannot be read answers as an import file does.
func renderCorrectionError(w http.ResponseWriter, r *http.Request, err error) {
	if errors.Is(err, carecontract.ErrContractCorrectionChanged) {
		common.RenderError(w, r, common.ErrorConflictWithCode(err, common.CodeCareContractImportChanged))
		return
	}
	renderImportError(w, r, err)
}
