package traegerviewhttp

import (
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/modules/traegerview"
	"github.com/moto-ogs/project-phoenix/sharedkernel/textnorm"
)

// Every list and report of the Träger-Portal is exported as PDF, Excel or
// CSV (#4718). The projection fills a ListTable with the rows its route
// shows, for one school or all; the root binds ListRenderer to the list
// contract of Document Rendering, so each export looks like every other
// export of moto. A request without a format gets CSV, the format the
// exports had before (docs/reference/exporte.md, Regel 6).

// The formats of a list export.
const (
	ListFormatPDF  = "pdf"
	ListFormatXLSX = "xlsx"
	ListFormatCSV  = "csv"
)

// ListColumn is one column of an exported list. A SpreadsheetOnly column
// repeats a value of the whole list on every row (the day, the window), so
// a spreadsheet can filter and combine several files; the PDF names it once
// in its head instead.
type ListColumn struct {
	// Numeric marks a count or decimal; empty values remain empty in Excel.
	Numeric         bool
	ID              string
	Label           string
	SpreadsheetOnly bool
}

// ListTable is one exported list: its head, its columns and its rows, the
// values of a row in the order of the columns.
type ListTable struct {
	Title    string
	Subtitle string
	Filters  []string
	Columns  []ListColumn
	Rows     [][]string
	// Footer stands on every page of the PDF, such as the note that the
	// list holds personal data.
	Footer   string
	Filename string
}

// ListFile is a rendered list.
type ListFile struct {
	Data        []byte
	ContentType string
	Filename    string
}

// ListRenderer renders a list in one of the list formats. It neither reads
// nor stores anything; the route decides who may read the list.
type ListRenderer func(table ListTable, format string) (ListFile, error)

// errUnknownListFormat answers a format other than PDF, Excel or CSV.
var errUnknownListFormat = errors.New("unsupported export format (use pdf, xlsx or csv)")

// listFormat reads the optional format of an export.
func listFormat(r *http.Request) (string, error) {
	switch format := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("format"))); format {
	case "":
		return ListFormatCSV, nil
	case ListFormatPDF, ListFormatXLSX, ListFormatCSV:
		return format, nil
	default:
		return "", fmt.Errorf("%w: %q", errUnknownListFormat, format)
	}
}

// writeList renders the table and answers it as a download that no cache
// keeps.
func writeList(w http.ResponseWriter, r *http.Request, render ListRenderer, format string, table ListTable) {
	file, err := render(table, format)
	if err != nil {
		common.RenderError(w, r, common.ErrorInternalServer(err))
		return
	}
	w.Header().Set("Content-Type", file.ContentType)
	w.Header().Set("Content-Disposition", textnorm.ContentDisposition("attachment", file.Filename))
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(file.Data)
}

// exportSchool reads the optional school of an export (school=ID). Zero
// means every school of the Träger.
func exportSchool(r *http.Request) (int64, error) {
	raw := r.URL.Query().Get("school")
	if raw == "" {
		return 0, nil
	}
	schoolID, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || schoolID <= 0 {
		return 0, errors.New("school must be a positive ID")
	}
	return schoolID, nil
}

// readExportOptions reads format and school of an export and answers 400
// for an invalid one.
func readExportOptions(w http.ResponseWriter, r *http.Request) (string, int64, bool) {
	format, err := listFormat(r)
	if err != nil {
		common.RenderError(w, r, common.ErrorInvalidRequest(err))
		return "", 0, false
	}
	schoolID, err := exportSchool(r)
	if err != nil {
		common.RenderError(w, r, common.ErrorInvalidRequest(err))
		return "", 0, false
	}
	return format, schoolID, true
}

// renderSchoolNotFound answers a school of another Träger and an unknown ID
// alike, so the export reveals no school.
func renderSchoolNotFound(w http.ResponseWriter, r *http.Request) {
	common.RenderError(w, r, common.ErrorNotFoundWithCode(traegerview.ErrSchoolOutsideTraeger, common.CodeTraegerSchoolNotFound))
}

// schoolFilterLabel names the schools of an export in its head.
func schoolFilterLabel(name string) string {
	if name == "" {
		return "Alle Schulen"
	}
	return "Schule: " + name
}

// periodLabel is „Zeitraum: 07.09.2026 bis 11.09.2026“.
func periodLabel(from, to string) string {
	return "Zeitraum: " + from + " bis " + to
}
