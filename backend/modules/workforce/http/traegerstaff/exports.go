package traegerstaff

import (
	"context"
	"errors"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/render"

	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/modules/workforce"
	"github.com/moto-ogs/project-phoenix/sharedkernel/textnorm"
)

// ExportsResource serves the exports of the Personalverwaltung over all
// schools (#4712, ADR 0089 section 11) at /traeger/staff-exports: the DATEV
// payroll file and the time export, each with the check the page shows
// before the download. Every route needs the Träger right „Personal“; each
// read writes the access log entry of every school before its values leave
// it.
type ExportsResource struct {
	exports      workforce.TraegerStaffExports
	requireStaff common.Middleware
}

// NewExportsResource builds the resource; the root binds requireStaff to
// the Träger right traeger_staff:manage.
func NewExportsResource(exports workforce.TraegerStaffExports, requireStaff common.Middleware) *ExportsResource {
	if exports == nil || requireStaff == nil {
		panic("workforce traeger staff exports: the exports and the right check are required")
	}
	return &ExportsResource{exports: exports, requireStaff: requireStaff}
}

// TraegerRouter returns the routes mounted at /traeger/staff-exports.
func (rs *ExportsResource) TraegerRouter(protectedTraegerRoutes func(chi.Router, func(chi.Router, common.Middleware))) chi.Router {
	r := chi.NewRouter()
	r.Use(render.SetContentType(render.ContentTypeJSON))
	protectedTraegerRoutes(r, func(r chi.Router, _ common.Middleware) {
		staff := r.With(rs.requireStaff)
		staff.Get("/payroll", rs.payrollReport)
		staff.Get("/payroll/export", rs.payrollFile)
		staff.Get("/times", rs.timeReport)
		staff.Get("/times/export", rs.timeFile)
	})
	return r
}

func (rs *ExportsResource) payrollReport(w http.ResponseWriter, r *http.Request) {
	session, month, ok := exportRequest(w, r)
	if !ok {
		return
	}
	report, err := rs.exports.PayrollReport(r.Context(), session, month)
	if err != nil {
		renderExportError(w, r, err)
		return
	}
	common.Respond(w, r, http.StatusOK, report, "Payroll export check retrieved successfully")
}

func (rs *ExportsResource) payrollFile(w http.ResponseWriter, r *http.Request) {
	rs.download(w, r, rs.exports.PayrollFile)
}

func (rs *ExportsResource) timeReport(w http.ResponseWriter, r *http.Request) {
	session, month, ok := exportRequest(w, r)
	if !ok {
		return
	}
	report, err := rs.exports.TimeReport(r.Context(), session, month)
	if err != nil {
		renderExportError(w, r, err)
		return
	}
	common.Respond(w, r, http.StatusOK, report, "Time export check retrieved successfully")
}

func (rs *ExportsResource) timeFile(w http.ResponseWriter, r *http.Request) {
	rs.download(w, r, rs.exports.TimeFile)
}

func (rs *ExportsResource) download(w http.ResponseWriter, r *http.Request,
	build func(context.Context, workforce.TraegerStaffActor, workforce.TraegerExportMonth) (workforce.TraegerExportFile, error),
) {
	session, month, ok := exportRequest(w, r)
	if !ok {
		return
	}
	file, err := build(r.Context(), session, month)
	if err != nil {
		renderExportError(w, r, err)
		return
	}
	w.Header().Set("Content-Type", file.ContentType)
	w.Header().Set("Content-Disposition", textnorm.ContentDisposition("attachment", file.Filename))
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(file.Data)
}

// exportRequest reads the session and ?year=&month=&format=.
func exportRequest(w http.ResponseWriter, r *http.Request) (workforce.TraegerStaffActor, workforce.TraegerExportMonth, bool) {
	session, ok := actor(w, r)
	if !ok {
		return workforce.TraegerStaffActor{}, workforce.TraegerExportMonth{}, false
	}
	month := workforce.TraegerExportMonth{Format: r.URL.Query().Get("format")}
	for _, field := range []struct {
		name  string
		value *int
	}{{"year", &month.Year}, {"month", &month.Month}} {
		parsed, err := strconv.Atoi(r.URL.Query().Get(field.name))
		if err != nil {
			common.RenderError(w, r, common.ErrorInvalidOnField(errors.New(field.name+" must be a number"), common.CodeGeneralInput, field.name))
			return workforce.TraegerStaffActor{}, workforce.TraegerExportMonth{}, false
		}
		*field.value = parsed
	}
	return session, month, true
}

// renderExportError answers a refused file with the report in details, so
// the page can show what is missing.
func renderExportError(w http.ResponseWriter, r *http.Request, err error) {
	if notReady, ok := errors.AsType[*workforce.TraegerPayrollNotReadyError](err); ok {
		common.RenderError(w, r, common.ErrorConflictWithDetails(err, common.CodeWorkforceTraegerPayrollNotReady,
			map[string]any{"report": notReady.Report}))
		return
	}
	if errors.Is(err, workforce.ErrTraegerExportInvalid) {
		common.RenderError(w, r, common.ErrorInvalidRequest(err))
		return
	}
	renderError(w, r, err)
}
