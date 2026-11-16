package api

import (
	"archive/zip"
	"bytes"
	"encoding/xml"

	"testing"

	traegerViewHTTP "github.com/moto-ogs/project-phoenix/modules/traegerview/http"

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

func TestTraegerListExcelNumericColumns(t *testing.T) {
	t.Parallel()
	file, err := traegerViewListRenderer(NewSimpleListRenderer())(traegerViewHTTP.ListTable{
		Title: "Auswertung", Filename: "auswertung",
		Columns: []traegerViewHTTP.ListColumn{
			{ID: "id", Label: "ID"}, {ID: "name", Label: "Name"},
			{ID: "count", Label: "Kinder", Numeric: true}, {ID: "average", Label: "Schnitt", Numeric: true},
		},
		Rows: [][]string{{"00123", "=1+1", "10", "2,5"}, {"00456", "123", "0", "-0,5"}, {"00789", "Leer", "", ""}},
	}, "xlsx")
	require.NoError(t, err)
	archive, err := zip.NewReader(bytes.NewReader(file.Data), int64(len(file.Data)))
	require.NoError(t, err)
	sheet, err := archive.Open("xl/worksheets/sheet2.xml")
	require.NoError(t, err)
	defer func() { require.NoError(t, sheet.Close()) }()
	var worksheet struct {
		Cells []struct {
			Reference string `xml:"r,attr"`
			Type      string `xml:"t,attr"`
			Value     string `xml:"v"`
			Formula   string `xml:"f"`
		} `xml:"sheetData>row>c"`
	}
	require.NoError(t, xml.NewDecoder(sheet).Decode(&worksheet))
	numbers := map[string]string{"C7": "10", "C8": "0", "D7": "2.5", "D8": "-0.5"}
	texts := map[string]bool{"A7": true, "B7": true, "B8": true, "C9": true, "D9": true}
	for _, cell := range worksheet.Cells {
		if value, ok := numbers[cell.Reference]; ok {
			assert.Empty(t, cell.Type, "numeric cells use the default type: %s", cell.Reference)
			assert.Equal(t, value, cell.Value, cell.Reference)
			delete(numbers, cell.Reference)
		}
		if texts[cell.Reference] {
			assert.Equal(t, "s", cell.Type, "names, IDs and blanks stay text: %s", cell.Reference)
			assert.Empty(t, cell.Formula, "user text must never become a formula")
			delete(texts, cell.Reference)
		}
	}
	assert.Empty(t, numbers, "all numeric cells must exist")
	assert.Empty(t, texts, "all text cells must exist")
}
