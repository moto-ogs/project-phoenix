package traegerviewhttp

import (
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/render"

	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/modules/identityaccess"
	"github.com/moto-ogs/project-phoenix/modules/traegerview"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/textnorm"
)

// ReportResource serves the key-date report of the Träger (#4716, ADR 0246)
// at /traeger/reports. Its routes need "Berichte lesen". The report holds
// counts and the names of schools, Sozialräume and care forms, no child and
// no staff member, so neither the report nor its export is written to the
// access log (ADR 0084 section 7).
type ReportResource struct {
	reports traegerview.KeyDateReports
}

// NewReportResource builds the resource.
func NewReportResource(reports traegerview.KeyDateReports) *ReportResource {
	if reports == nil {
		panic("traeger view http: the key-date reports are required")
	}
	return &ReportResource{reports: reports}
}

// TraegerRouter returns the routes mounted at /traeger/reports inside the
// Träger route group. The projection reads in its own administrative unit,
// so it does not use the Träger transaction the group offers.
func (rs *ReportResource) TraegerRouter(protectedTraegerRoutes func(chi.Router, func(chi.Router, common.Middleware))) chi.Router {
	r := chi.NewRouter()
	r.Use(render.SetContentType(render.ContentTypeJSON))
	protectedTraegerRoutes(r, func(r chi.Router, _ common.Middleware) {
		read := r.With(common.RequiresPermission(identityaccess.TraegerRightReportsRead))
		read.Get("/key-date", rs.keyDateReport)
		read.Get("/key-date/export", rs.keyDateReportExport)
	})
	return r
}

// keyDateReport answers GET /traeger/reports/key-date?key_date=&template=.
func (rs *ReportResource) keyDateReport(w http.ResponseWriter, r *http.Request) {
	report, ok := rs.readKeyDateReport(w, r)
	if !ok {
		return
	}
	common.Respond(w, r, http.StatusOK, report, "Key-date report retrieved successfully")
}

// keyDateReportExport answers GET /traeger/reports/key-date/export with
// format=pdf, xlsx or csv: the same report as a file.
func (rs *ReportResource) keyDateReportExport(w http.ResponseWriter, r *http.Request) {
	organizationID, keyDate, templateID, ok := keyDateReportRequest(w, r)
	if !ok {
		return
	}
	format := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("format")))
	file, err := rs.reports.KeyDateReportExport(r.Context(), organizationID, keyDate, templateID, format)
	if !renderKeyDateReportError(w, r, err) {
		return
	}
	w.Header().Set("Content-Type", file.ContentType)
	w.Header().Set("Content-Disposition", textnorm.ContentDisposition("attachment", file.Filename))
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(file.Data)
}

func (rs *ReportResource) readKeyDateReport(w http.ResponseWriter, r *http.Request) (traegerview.KeyDateReport, bool) {
	organizationID, keyDate, templateID, ok := keyDateReportRequest(w, r)
	if !ok {
		return traegerview.KeyDateReport{}, false
	}
	report, err := rs.reports.KeyDateReport(r.Context(), organizationID, keyDate, templateID)
	return report, renderKeyDateReportError(w, r, err)
}

// keyDateReportRequest reads the Träger of the session and the query, or
// renders the refusal.
func keyDateReportRequest(w http.ResponseWriter, r *http.Request) (int64, calendar.Date, int64, bool) {
	principal, err := common.CurrentPrincipal(r.Context())
	if err != nil || principal.OrganizationID() <= 0 {
		common.RenderError(w, r, common.ErrorUnauthorized(common.ErrUnauthorized))
		return 0, "", 0, false
	}
	keyDate, templateID, err := keyDateReportQuery(r)
	if err != nil {
		common.RenderError(w, r, common.ErrorInvalidRequest(err))
		return 0, "", 0, false
	}
	return principal.OrganizationID(), keyDate, templateID, true
}

// renderKeyDateReportError renders a refused report and reports whether
// there was none.
func renderKeyDateReportError(w http.ResponseWriter, r *http.Request, err error) bool {
	switch {
	case err == nil:
		return true
	case errors.Is(err, traegerview.ErrInvalidKeyDate), errors.Is(err, traegerview.ErrUnsupportedReportFormat):
		common.RenderError(w, r, common.ErrorInvalidRequest(err))
	case errors.Is(err, traegerview.ErrReportTemplateNotFound):
		common.RenderError(w, r, common.ErrorNotFoundWithCode(err, common.CodeTraegerReportTemplateNotFound))
	case errors.Is(err, traegerview.ErrTraegerUnavailable):
		common.RenderError(w, r, common.ErrorUnauthorized(common.ErrUnauthorized))
	default:
		common.RenderError(w, r, common.ErrorInternalServer(err))
	}
	return false
}

// keyDateReportQuery reads the required key_date (YYYY-MM-DD) and the
// optional template ID.
func keyDateReportQuery(r *http.Request) (calendar.Date, int64, error) {
	query := r.URL.Query()
	keyDate, err := calendar.ParseDate(query.Get("key_date"))
	if err != nil {
		return "", 0, fmt.Errorf("%w: key_date must be a date (YYYY-MM-DD)", traegerview.ErrInvalidKeyDate)
	}
	raw := strings.TrimSpace(query.Get("template"))
	if raw == "" {
		return keyDate, 0, nil
	}
	templateID, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || templateID <= 0 {
		return "", 0, errors.New("template must be a positive ID")
	}
	return keyDate, templateID, nil
}
