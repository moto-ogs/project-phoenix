package reportexport

import (
	"archive/zip"
	"bytes"
	"encoding/csv"
	"io"
	"strings"
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
	assert.Equal(t, "2 · – Kinder pro Person", lines["Personal"], "no ratio without the figure")
	require.Len(t, school.Subs, 1)
	require.Len(t, school.Subs[0].Fields, 1)
	assert.Equal(t, "Bis 16 Uhr", school.Subs[0].Fields[0].Label)
	assert.Equal(t, "10 Kinder von 40 Plätzen", school.Subs[0].Fields[0].Value)
	assert.Equal(t, "Summe Nord", doc.Groups[0].Records[1].Title)
	assert.Equal(t, "Gesamt (1 Schule)", doc.Groups[1].Records[0].Title)
}

func TestKeyDateExportKeepsNamedAndUnmappedSchoolsInTheirOwnGroups(t *testing.T) {
	t.Parallel()
	report := districtReport()
	name := traegerview.UnmappedDistrict
	report.Schools[0].District = &name
	report.Schools = append(report.Schools, traegerview.KeyDateSchool{ID: 2, Name: "OGS Lindenweg"})
	report.Districts[0].Name = name
	report.Districts = append(report.Districts, traegerview.KeyDateDistrict{Name: name, Unmapped: true, Schools: 1})
	doc := keyDateReportDocument(report)
	counts := map[string]int{}
	for _, row := range doc.Rows {
		if row.Values[reportColumnCareForm] == "" {
			counts[row.Values[reportColumnSchool]]++
		}
	}
	assert.Equal(t, 1, counts["OGS Am Park"])
	assert.Equal(t, 1, counts["OGS Lindenweg"])
	records := keyDateReportRecords(report)
	require.Len(t, records.Groups[0].Records, 2)
	require.Len(t, records.Groups[1].Records, 2)
	assert.Equal(t, "OGS Am Park, Bonn", records.Groups[0].Records[0].Title)
	assert.Equal(t, "OGS Lindenweg", records.Groups[1].Records[0].Title)
}

func TestKeyDateExportIncludesReferenceDatesAndAttendanceCoverage(t *testing.T) {
	t.Parallel()
	report := districtReport()
	report.AbsenceWindow = &traegerview.ReportWindow{From: calendar.NewDate(2026, time.August, 1), To: report.KeyDate}
	first := calendar.NewDate(2026, time.September, 1)
	report.Schools[0].AttendanceFrom = &first
	doc := keyDateReportDocument(report)
	labels := map[string]bool{}
	for _, column := range doc.Columns {
		labels[column.Label] = true
	}
	assert.True(t, labels["Kinder pro Person"])
	var found bool
	for _, row := range doc.Rows {
		if len(row.Values) == 0 {
			continue
		}
		assert.Equal(t, "2026-10-15", row.Values["key_date"])
		assert.Equal(t, "2026-11-15", row.Values["demand_as_of"])
		assert.Equal(t, "2026-08-01", row.Values["absence_from"])
		assert.Equal(t, "2026-10-15", row.Values["absence_to"])
		if row.Values[reportColumnSchool] == "OGS Am Park" && row.Values[reportColumnCareForm] == "" {
			found = true
			assert.Equal(t, "2026-09-01", row.Values["attendance_from"])
			assert.Contains(t, row.Values["attendance_note"], "Frühere Tage fehlen.")
		}
	}
	assert.True(t, found)
	record := keyDateReportRecords(report).Groups[0].Records[0]
	fields := map[string]string{}
	for _, field := range record.Fields {
		fields[field.Label] = field.Value
	}
	assert.Equal(t, "01.09.2026", fields["Check-ins ab"])
	assert.Contains(t, fields["Datenumfang"], "Frühere Tage fehlen.")

	file, err := New().RenderKeyDateReport(report, traegerview.ReportFormatCSV)
	require.NoError(t, err)
	reader := csv.NewReader(bytes.NewReader(bytes.TrimPrefix(file.Data, []byte("\xef\xbb\xbf"))))
	reader.Comma = ';'
	rows, err := reader.ReadAll()
	require.NoError(t, err)
	column := map[string]int{}
	for i, label := range rows[0] {
		column[label] = i
	}
	for label, value := range map[string]string{
		"Stichtag": "2026-10-15", "Anmeldungen Stand": "2026-11-15",
		"Fehlzeiten von": "2026-08-01", "Fehlzeiten bis": "2026-10-15", "Check-ins ab": "2026-09-01",
	} {
		index, ok := column[label]
		require.True(t, ok, label)
		assert.Equal(t, value, rows[1][index], label)
	}
	assert.Contains(t, strings.Join(rows[1], " "), "Frühere Tage fehlen.")
	file, err = New().RenderKeyDateReport(report, traegerview.ReportFormatXLSX)
	require.NoError(t, err)
	workbook, err := zip.NewReader(bytes.NewReader(file.Data), int64(len(file.Data)))
	require.NoError(t, err)
	shared, err := workbook.Open("xl/sharedStrings.xml")
	require.NoError(t, err)
	defer func() { require.NoError(t, shared.Close()) }()
	content, err := io.ReadAll(shared)
	require.NoError(t, err)
	for _, value := range []string{"2026-10-15", "2026-11-15", "2026-08-01", "2026-09-01", "Frühere Tage fehlen.", "Kinder pro Person"} {
		assert.Contains(t, string(content), value)
	}
}

func TestKeyDateExportCoverageDistinguishesCompleteMissingAndEmptyWindows(t *testing.T) {
	t.Parallel()
	from := calendar.NewDate(2026, time.August, 1)
	later := calendar.NewDate(2026, time.November, 1)
	for _, c := range []struct {
		name   string
		first  *calendar.Date
		window bool
		note   string
	}{
		{"complete", &from, true, ""},
		{"no check-ins", nil, true, "Keine Check-ins im Zeitraum gespeichert."},
		{"check-ins after the window", &later, true, "Keine Check-ins im Zeitraum gespeichert."},
		{"no completed day", nil, false, ""},
	} {
		t.Run(c.name, func(t *testing.T) {
			report := districtReport()
			report.Schools[0].AttendanceFrom = c.first
			if c.window {
				report.AbsenceWindow = &traegerview.ReportWindow{From: from, To: report.KeyDate}
			}
			doc := keyDateReportDocument(report)
			assert.Equal(t, c.note, doc.Rows[1].Values[reportColumnAttendanceNote])
			fields := keyDateReportRecords(report).Groups[0].Records[0].Fields
			var note string
			for _, field := range fields {
				if field.Label == "Datenumfang" {
					note = field.Value
				}
			}
			assert.Equal(t, c.note, note)
		})
	}
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
