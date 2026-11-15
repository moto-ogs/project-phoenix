package reportexport

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/moto-ogs/project-phoenix/modules/traegerview"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

func districtReport() traegerview.KeyDateReport {
	nord := "Nord"
	capacity := 40
	figures := traegerview.KeyDateFigures{Children: 12, WithoutCareForm: 2, Staff: 2, Places: 40, BookedPlaces: 10, FreePlaces: 30, Demand: 12}
	forms := []traegerview.KeyDateCareForm{{Name: "Bis 16 Uhr", Children: 10, Capacity: &capacity, Active: true}}
	return traegerview.KeyDateReport{
		KeyDate:  calendar.NewDate(2026, time.October, 15),
		AsOf:     time.Date(2026, time.November, 15, 10, 0, 0, 0, time.UTC),
		Sections: traegerview.ReportSections(),
		Schools: []traegerview.KeyDateSchool{
			{ID: 1, Name: "OGS Am Park", City: "Bonn", District: &nord, Figures: figures, CareForms: forms},
		},
		Districts: []traegerview.KeyDateDistrict{{Name: "Nord", Schools: 1, Figures: figures, CareForms: forms}},
		Total:     traegerview.KeyDateTotal{Schools: 1, Figures: figures, CareForms: forms},
	}
}

// A row that opens a group is only its title in every renderer; a school
// row that carried the title was dropped from the PDF (#4716).
func TestKeyDateReportDocumentKeepsGroupTitlesOutOfDataRows(t *testing.T) {
	t.Parallel()
	doc := keyDateReportDocument(districtReport())
	var schoolRows int
	for _, row := range doc.Rows {
		if row.GroupTitle != "" {
			assert.Empty(t, row.Values, "group title %q carries values", row.GroupTitle)
			continue
		}
		if row.Values[reportColumnSchool] == "OGS Am Park" && row.Values[reportColumnCareForm] == "" {
			schoolRows++
			assert.Equal(t, "12", row.Values[reportColumnChildren])
		}
	}
	assert.Equal(t, 1, schoolRows)
}

func TestKeyDateReportRecordsPrintACardPerSchoolDistrictAndTotal(t *testing.T) {
	t.Parallel()
	doc := keyDateReportRecords(districtReport())
	require.Len(t, doc.Groups, 2)
	assert.Equal(t, "Nord", doc.Groups[0].Title)
	require.Len(t, doc.Groups[0].Records, 2)
	school := doc.Groups[0].Records[0]
	assert.Equal(t, "OGS Am Park, Bonn", school.Title)
	lines := map[string]string{}
	for _, field := range school.Fields {
		lines[field.Label] = field.Value
	}
	assert.Equal(t, "10 von 40 belegt · 30 frei", lines["Plätze"])
	assert.Equal(t, "2 · – Kinder je Fachkraft", lines["Personal"], "no ratio without the figure")
	require.Len(t, school.Subs, 1)
	require.Len(t, school.Subs[0].Fields, 1)
	assert.Equal(t, "Bis 16 Uhr", school.Subs[0].Fields[0].Label)
	assert.Equal(t, "10 Kinder von 40 Plätzen", school.Subs[0].Fields[0].Value)
	assert.Equal(t, "Summe Nord", doc.Groups[0].Records[1].Title)
	assert.Equal(t, "Gesamt (1 Schule)", doc.Groups[1].Records[0].Title)
}

func TestKeyDateReportRendersEveryFormat(t *testing.T) {
	t.Parallel()
	renderer := New()
	for _, format := range []string{traegerview.ReportFormatPDF, traegerview.ReportFormatXLSX, traegerview.ReportFormatCSV} {
		file, err := renderer.RenderKeyDateReport(districtReport(), format)
		require.NoError(t, err, format)
		assert.Equal(t, "bericht-stichtag-2026-10-15."+format, file.Filename, format)
		assert.NotEmpty(t, file.Data, format)
	}
}
