package api

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

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
