package carecontracthttp

import (
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/sharedkernel/textnorm"
)

// The lists of the Betreuungsvertrag are exported as PDF, Excel or CSV like every
// list of the Träger-Portal (#4718). The resource fills a ListTable; the root
// binds ListRenderer to the list contract of Document Rendering. A request
// without a format gets CSV, the format the export had before.

// ListColumn is one column of an exported list.
type ListColumn struct {
	// Numeric marks a count or decimal; empty values remain empty in Excel.
	Numeric bool
	ID      string
	Label   string
}

// ListTable is one exported list; the values of a row follow the columns.
type ListTable struct {
	Title    string
	Subtitle string
	Filters  []string
	Columns  []ListColumn
	Rows     [][]string
	Footer   string
	Filename string
}

// ListFile is a rendered list.
type ListFile struct {
	Data        []byte
	ContentType string
	Filename    string
}

// ListRenderer renders a list as "pdf", "xlsx" or "csv". It neither reads
// nor stores anything.
type ListRenderer func(table ListTable, format string) (ListFile, error)

var errUnknownListFormat = errors.New("unsupported export format (use pdf, xlsx or csv)")

// listFormat reads the optional format of an export.
func listFormat(r *http.Request) (string, error) {
	switch format := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("format"))); format {
	case "":
		return "csv", nil
	case "pdf", "xlsx", "csv":
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

// personalDataFooter stands on every page of an export with personal data.
const personalDataFooter = "Vertraulich. Enthält personenbezogene Daten."

// schoolFilterLabel names the schools of an export in its head.
func schoolFilterLabel(schoolID int64, schoolName string) string {
	switch {
	case schoolID == 0:
		return "Alle Schulen"
	case schoolName == "":
		return "Schule: ausgewählte Schule"
	default:
		return "Schule: " + schoolName
	}
}
