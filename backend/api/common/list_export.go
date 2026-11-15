package common

import (
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/textnorm"
)

// Every list and report of the Träger-Portal is exported as PDF, Excel or
// CSV (#4718). The route that serves a list fills a ListTable with the rows it
// shows, under the same right and filters; the composition root binds
// ListRenderer to the list contract of Document Rendering, so every export
// looks the same and an owner needs no dependency on the renderer. A request
// without a format gets CSV (docs/reference/exporte.md, Regel 6).

// The formats of a list export.
const (
	ListFormatPDF  = "pdf"
	ListFormatXLSX = "xlsx"
	ListFormatCSV  = "csv"
)

// ListColumn is one column of an exported list. A SpreadsheetOnly column
// repeats a value of the whole list on every row (the day, the window), so a
// spreadsheet can filter and combine several files; the PDF names it once in
// its head instead.
type ListColumn struct {
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
	// Footer stands on every page of the PDF, such as the note that the list
	// holds personal data.
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

// ListPersonalDataFooter stands on every page of an export with personal
// data.
const ListPersonalDataFooter = "Vertraulich. Enthält personenbezogene Daten."

var errUnknownListFormat = errors.New("unsupported export format (use pdf, xlsx or csv)")

// ParseListFormat reads the optional format of a list export.
func ParseListFormat(r *http.Request) (string, error) {
	switch format := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("format"))); format {
	case "":
		return ListFormatCSV, nil
	case ListFormatPDF, ListFormatXLSX, ListFormatCSV:
		return format, nil
	default:
		return "", fmt.Errorf("%w: %q", errUnknownListFormat, format)
	}
}

// ListFormatOf reads the format of a list export and answers 400 for an
// unknown one; ok is false then.
func ListFormatOf(w http.ResponseWriter, r *http.Request) (string, bool) {
	format, err := ParseListFormat(r)
	if err != nil {
		RenderError(w, r, ErrorInvalidRequest(err))
		return "", false
	}
	return format, true
}

// WriteList renders the table and answers it as a download that no cache
// keeps.
func WriteList(w http.ResponseWriter, r *http.Request, render ListRenderer, format string, table ListTable) {
	file, err := render(table, format)
	if err != nil {
		RenderError(w, r, ErrorInternalServer(err))
		return
	}
	w.Header().Set("Content-Type", file.ContentType)
	w.Header().Set("Content-Disposition", textnorm.ContentDisposition("attachment", file.Filename))
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(file.Data)
}

// ListSchoolLabel names the schools of an export in its head: every school
// without a name, else the one school.
func ListSchoolLabel(schoolName string) string {
	if schoolName == "" {
		return "Alle Schulen"
	}
	return "Schule: " + schoolName
}

// ListPeriodLabel is „Zeitraum: 07.09.2026 bis 11.09.2026“.
func ListPeriodLabel(from, to string) string {
	return "Zeitraum: " + from + " bis " + to
}

// ListDate is a calendar day in an export: „07.09.2026“, empty without one.
func ListDate(day calendar.Date) string {
	if day.IsZero() {
		return ""
	}
	return day.Format("02.01.2006")
}

// ListInstant is an instant in an export, on the Berlin wall clock:
// „07.09.2026, 14:30“.
func ListInstant(at time.Time) string {
	return at.In(calendar.Berlin).Format("02.01.2006, 15:04")
}

// ListCutNote stands in the head of an export that holds only the newest
// entries of a longer list, so nobody takes the file for the whole list.
func ListCutNote(limit int) string {
	return "Gekürzt: nur die neuesten " + groupedThousands(limit) + " Einträge"
}

// groupedThousands writes 10000 as „10.000“.
func groupedThousands(n int) string {
	digits := strconv.Itoa(n)
	var b strings.Builder
	for i, digit := range digits {
		if i > 0 && (len(digits)-i)%3 == 0 {
			b.WriteByte('.')
		}
		b.WriteRune(digit)
	}
	return b.String()
}
