package api

import (
	"encoding/csv"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestTruncatedTraegerListCSV(t *testing.T) {
	t.Parallel()
	table := common.ListTable{
		Title: "Exportprotokoll", Filename: "exportprotokoll", Filters: []string{"Alle Schulen"},
		Columns: []common.ListColumn{{ID: "number", Label: "Nr."}},
		Rows:    [][]string{{"3"}, {"2"}},
	}
	common.MarkListTruncated(&table, 2)
	for _, format := range []string{"pdf", "xlsx"} {
		_, err := traegerListRenderer(func(doc SimpleListDocument, _, _ string) (SimpleListFile, error) {
			assert.Equal(t, []string{"Alle Schulen", "Gekürzt: nur die neuesten 2 Einträge"}, doc.Filters)
			if format == "pdf" {
				assert.Equal(t, []SimpleListColumn{{ID: "number", Label: "Nr."}}, doc.Columns)
				assert.Equal(t, [][]string{{"3"}, {"2"}}, doc.Rows)
			} else {
				assert.Equal(t, []SimpleListColumn{{ID: "number", Label: "Nr."}, {ID: "truncation_note", Label: "Hinweis"}}, doc.Columns)
				assert.Equal(t, table.Rows, doc.Rows)
			}
			return SimpleListFile{}, nil
		})(table, format)
		require.NoError(t, err)
	}
	rec := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/export", nil)
	format, err := common.ParseListFormat(req)
	require.NoError(t, err)
	common.WriteList(rec, req, traegerListRenderer(NewSimpleListRenderer()), format, table)
	require.Equal(t, 200, rec.Code)
	reader := csv.NewReader(strings.NewReader(strings.TrimPrefix(rec.Body.String(), "\xEF\xBB\xBF")))
	reader.Comma = ';'
	rows, err := reader.ReadAll()
	require.NoError(t, err, "CSV keeps a header and equally sized data rows")
	assert.Equal(t, [][]string{
		{"Nr.", "Hinweis"},
		{"3", "Gekürzt: nur die neuesten 2 Einträge"},
		{"2", "Gekürzt: nur die neuesten 2 Einträge"},
	}, rows)
}

// The PDF of a Träger list names the values of the whole list once in its
// head, so it leaves out the columns that repeat them on every row; Excel
// and CSV keep them for a spreadsheet (#4718).
func TestTraegerListPDFLeavesOutSpreadsheetOnlyColumns(t *testing.T) {
	t.Parallel()
	var rendered []SimpleListDocument
	capture := func(doc SimpleListDocument, format, filename string) (SimpleListFile, error) {
		rendered = append(rendered, doc)
		return SimpleListFile{Filename: filename + "." + format}, nil
	}
	list := traegerList{
		Title: "Belegung", Filters: []string{"Alle Schulen"}, Filename: "belegung",
		Columns: []traegerListColumn{{ID: "day", Label: "Datum", SpreadsheetOnly: true}, {ID: "school", Label: "Schule"}, {ID: "children", Label: "Kinder"}},
		Rows:    [][]string{{"15.11.2026", "OGS Am Bach", "3"}},
	}
	for _, format := range []string{"pdf", "xlsx", "csv"} {
		file, err := renderTraegerList(capture, list, format)
		require.NoError(t, err, format)
		assert.Equal(t, "belegung."+format, file.Filename)
	}
	require.Len(t, rendered, 3)
	assert.Equal(t, []SimpleListColumn{{ID: "school", Label: "Schule"}, {ID: "children", Label: "Kinder"}}, rendered[0].Columns)
	assert.Equal(t, [][]string{{"OGS Am Bach", "3"}}, rendered[0].Rows)
	for _, doc := range rendered[1:] {
		assert.Len(t, doc.Columns, 3, "Excel and CSV keep every column")
		assert.Equal(t, [][]string{{"15.11.2026", "OGS Am Bach", "3"}}, doc.Rows)
	}
	assert.Equal(t, []string{"Alle Schulen"}, rendered[0].Filters)
	assert.False(t, rendered[0].GeneratedAt.IsZero(), "the head names when the file was made")

	_, err := renderTraegerList(capture, list, "docx")
	assert.Error(t, err, "Word is no format of a Träger list")
	_, err = renderTraegerList(capture, traegerList{Columns: list.Columns, Rows: [][]string{{"zu kurz"}}}, "csv")
	assert.Error(t, err, "a row must have a value per column")
}
