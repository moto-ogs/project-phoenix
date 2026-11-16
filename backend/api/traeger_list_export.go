package api

import (
	"fmt"
	"time"

	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/modules/documentrendering/lists"
)

// The lists and reports of the Träger-Portal are exported as PDF, Excel or
// CSV (#4718). Each owner fills its list in its own port type; the root binds
// every one to the same rendering below, so every export of the portal
// shares one look and one set of rules.

// traegerListColumn is one column of a Träger list export. A
// SpreadsheetOnly column repeats a value of the whole list on every row so a
// spreadsheet can combine files; the PDF names it once in its head.
type traegerListColumn struct {
	// Numeric marks a count or decimal; empty values remain empty in Excel.
	Numeric         bool
	ID              string
	Label           string
	SpreadsheetOnly bool
}

// traegerList is one Träger list export as an owner fills it.
type traegerList struct {
	Title, Subtitle string
	Filters         []string
	Columns         []traegerListColumn
	Rows            [][]string
	Footer          string
	Filename        string
}

// traegerListFormats are the formats of a Träger list export.
var traegerListFormats = map[string]bool{string(lists.FormatPDF): true, string(lists.FormatXLSX): true, string(lists.FormatCSV): true}

// renderTraegerList renders a Träger list through the Document Rendering
// list contract. The PDF leaves out the spreadsheet-only columns, which its
// head already names; Excel and CSV keep every column.
func renderTraegerList(render SimpleListRenderer, list traegerList, format string) (SimpleListFile, error) {
	if !traegerListFormats[format] {
		return SimpleListFile{}, fmt.Errorf("traeger list export: unsupported format %q", format)
	}
	keep := make([]int, 0, len(list.Columns))
	columns := make([]SimpleListColumn, 0, len(list.Columns))
	for i, column := range list.Columns {
		if column.SpreadsheetOnly && format == string(lists.FormatPDF) {
			continue
		}
		keep = append(keep, i)
		columns = append(columns, SimpleListColumn{ID: column.ID, Label: column.Label, Numeric: column.Numeric})
	}
	rows := make([][]string, 0, len(list.Rows))
	for rowIndex, row := range list.Rows {
		if len(row) != len(list.Columns) {
			return SimpleListFile{}, fmt.Errorf("traeger list export: row %d has %d values for %d columns", rowIndex, len(row), len(list.Columns))
		}
		values := make([]string, len(keep))
		for i, index := range keep {
			values[i] = row[index]
		}
		rows = append(rows, values)
	}
	return render(SimpleListDocument{
		Title: list.Title, Subtitle: list.Subtitle, GeneratedAt: time.Now(), Filters: list.Filters,
		Columns: columns, Rows: rows, Footer: list.Footer,
	}, format, list.Filename)
}

// traegerListRenderer binds the shared list export port of the
// Träger-Portal routes (common.ListRenderer) to Document Rendering.
func traegerListRenderer(render SimpleListRenderer) common.ListRenderer {
	return func(table common.ListTable, format string) (common.ListFile, error) {
		columns := make([]traegerListColumn, len(table.Columns))
		for i, column := range table.Columns {
			columns[i] = traegerListColumn{ID: column.ID, Label: column.Label, SpreadsheetOnly: column.SpreadsheetOnly, Numeric: column.Numeric}
		}
		file, err := renderTraegerList(render, traegerList{
			Title: table.Title, Subtitle: table.Subtitle, Filters: table.Filters, Columns: columns,
			Rows: table.Rows, Footer: table.Footer, Filename: table.Filename,
		}, format)
		return common.ListFile{Data: file.Data, ContentType: file.ContentType, Filename: file.Filename}, err
	}
}
