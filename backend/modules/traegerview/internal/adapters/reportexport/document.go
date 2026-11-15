// Package reportexport renders the key-date report of the Träger projection
// (#4716, ADR 0242) as a PDF, XLSX or CSV file through the list contract of
// Document Rendering. It writes and reads nothing.
package reportexport

import (
	"fmt"
	"slices"
	"strconv"
	"strings"

	"github.com/moto-ogs/project-phoenix/modules/documentrendering/lists"
	"github.com/moto-ogs/project-phoenix/modules/traegerview"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// The export of the key-date report (#4716, ADR 0242) is one list document:
// a row per school, grouped by Sozialraum with a sum row per Sozialraum and
// a last row "Gesamt", then, when the report shows the children, a block
// "Kinder je Betreuungsform" with a row per school and care form. Its columns
// follow the sections of the report. Every name comes from the Träger-Büro
// or the schools and is sanitized before the renderer sees it; the CSV
// renderer keeps a cell from being read as a formula.

// The columns of the export.
const (
	reportColumnSchool       lists.ColumnID = "school"
	reportColumnCity         lists.ColumnID = "city"
	reportColumnDistrict     lists.ColumnID = "district"
	reportColumnCareForm     lists.ColumnID = "care_form"
	reportColumnChildren     lists.ColumnID = "children"
	reportColumnWithoutForm  lists.ColumnID = "without_care_form"
	reportColumnStaff        lists.ColumnID = "staff"
	reportColumnPerStaff     lists.ColumnID = "children_per_staff"
	reportColumnPresent      lists.ColumnID = "present_days"
	reportColumnSick         lists.ColumnID = "sick_days"
	reportColumnExcused      lists.ColumnID = "excused_days"
	reportColumnAbsenceRate  lists.ColumnID = "absence_rate"
	reportColumnPlaces       lists.ColumnID = "places"
	reportColumnBookedPlaces lists.ColumnID = "booked_places"
	reportColumnFreePlaces   lists.ColumnID = "free_places"
	reportColumnOpen         lists.ColumnID = "open"
	reportColumnWaitlisted   lists.ColumnID = "waitlisted"
	reportColumnDemand       lists.ColumnID = "demand"
)

// The labels of the rows and blocks the export adds.
const (
	reportTotalLabel           = "Gesamt"
	reportSumLabel             = "Summe "
	reportAllSchoolsGroup      = "Alle Standorte"
	reportCareFormGroup        = "Kinder je Betreuungsform"
	reportWithoutCareFormLabel = "Ohne Betreuungsform"
)

// reportSectionColumns are the figure columns of each section in order.
var reportSectionColumns = map[string][]lists.Column{
	traegerview.ReportSectionChildren: {
		{ID: reportColumnChildren, Label: "Kinder"},
		{ID: reportColumnWithoutForm, Label: "Ohne Betreuungsform"},
	},
	traegerview.ReportSectionStaff: {
		{ID: reportColumnStaff, Label: "Personal"},
		{ID: reportColumnPerStaff, Label: "Kinder je Fachkraft"},
	},
	traegerview.ReportSectionAbsences: {
		{ID: reportColumnPresent, Label: "Anwesenheitstage"},
		{ID: reportColumnSick, Label: "Krankheitstage"},
		{ID: reportColumnExcused, Label: "Entschuldigte Tage"},
		{ID: reportColumnAbsenceRate, Label: "Fehlquote %"},
	},
	traegerview.ReportSectionDemand: {
		{ID: reportColumnPlaces, Label: "Plätze"},
		{ID: reportColumnBookedPlaces, Label: "Belegte Plätze"},
		{ID: reportColumnFreePlaces, Label: "Freie Plätze"},
		{ID: reportColumnOpen, Label: "Offene Anmeldungen"},
		{ID: reportColumnWaitlisted, Label: "Warteliste"},
		{ID: reportColumnDemand, Label: "Nachfrage"},
	},
}

// Renderer renders a key-date report through Document Rendering.
type Renderer struct {
	lists lists.Renderer
}

// New builds the renderer.
func New() Renderer {
	return Renderer{lists: lists.NewRenderer()}
}

var formats = map[string]lists.Format{
	traegerview.ReportFormatPDF:  lists.FormatPDF,
	traegerview.ReportFormatXLSX: lists.FormatXLSX,
	traegerview.ReportFormatCSV:  lists.FormatCSV,
}

// SupportsReportFormat reports whether the format is one of the
// traegerview.ReportFormat constants.
func (r Renderer) SupportsReportFormat(format string) bool {
	_, ok := formats[format]
	return ok
}

// RenderKeyDateReport renders the report in the format; the file is named
// bericht-stichtag-<key date> with the extension of the format.
func (r Renderer) RenderKeyDateReport(report traegerview.KeyDateReport, format string) (traegerview.ReportFile, error) {
	listFormat, ok := formats[format]
	if !ok {
		return traegerview.ReportFile{}, fmt.Errorf("%w: %q", traegerview.ErrUnsupportedReportFormat, format)
	}
	file, err := r.lists.Render(keyDateReportDocument(report), listFormat, "bericht-stichtag-"+report.KeyDate.String())
	if err != nil {
		return traegerview.ReportFile{}, err
	}
	return traegerview.ReportFile{Data: file.Data, ContentType: file.ContentType, Filename: file.Filename}, nil
}

// keyDateReportDocument lays the report out as a list document.
func keyDateReportDocument(report traegerview.KeyDateReport) lists.Document {
	children := slices.Contains(report.Sections, traegerview.ReportSectionChildren)
	grouped := len(report.Districts) > 0
	doc := lists.Document{
		Title:       "Bericht zum Stichtag " + report.KeyDate.Format("02.01.2006"),
		GeneratedAt: report.AsOf,
		Filters:     keyDateReportHeader(report),
		Columns:     keyDateReportColumns(report.Sections, grouped, children),
	}
	if report.Template != nil {
		doc.Subtitle = lists.SanitizeUserText(report.Template.Name)
	}
	doc.Rows = keyDateSchoolRows(report, grouped)
	if children {
		doc.Rows = append(doc.Rows, keyDateCareFormRows(report, grouped)...)
	}
	return doc
}

// keyDateReportHeader names the key date and the windows the figures cover.
func keyDateReportHeader(report traegerview.KeyDateReport) []string {
	header := []string{"Stichtag: " + report.KeyDate.Format("02.01.2006")}
	if slices.Contains(report.Sections, traegerview.ReportSectionAbsences) {
		window := "kein abgeschlossener Tag"
		if report.AbsenceWindow != nil {
			window = report.AbsenceWindow.From.Format("02.01.2006") + " bis " + report.AbsenceWindow.To.Format("02.01.2006")
		}
		header = append(header, "Fehlzeiten-Zeitraum: "+window)
	}
	if slices.Contains(report.Sections, traegerview.ReportSectionDemand) {
		header = append(header, "Stand der Anmeldungen: "+calendar.DateFromTime(report.AsOf).Format("02.01.2006"))
	}
	return header
}

func keyDateReportColumns(sections []string, grouped, children bool) []lists.Column {
	columns := []lists.Column{{ID: reportColumnSchool, Label: "Standort"}, {ID: reportColumnCity, Label: "Ort"}}
	if grouped {
		columns = append(columns, lists.Column{ID: reportColumnDistrict, Label: "Sozialraum"})
	}
	if children {
		columns = append(columns, lists.Column{ID: reportColumnCareForm, Label: "Betreuungsform"})
	}
	for _, section := range traegerview.ReportSections() {
		if slices.Contains(sections, section) {
			columns = append(columns, reportSectionColumns[section]...)
		}
	}
	// The block of care forms prints the places of each form.
	if children && !slices.Contains(sections, traegerview.ReportSectionDemand) {
		columns = append(columns, lists.Column{ID: reportColumnPlaces, Label: "Plätze"})
	}
	return columns
}

// keyDateSchoolRows prints a row per school, per Sozialraum its sum and the
// total last.
func keyDateSchoolRows(report traegerview.KeyDateReport, grouped bool) []lists.Row {
	total := keyDateFigureRow(reportTotalLabel, "", "", report.Sections, report.Total.Figures)
	if grouped {
		total.GroupTitle = reportTotalLabel
		return append(keyDateDistrictRows(report), total)
	}
	var rows []lists.Row
	for _, school := range report.Schools {
		rows = append(rows, keyDateFigureRow(school.Name, school.City, "", report.Sections, school.Figures))
	}
	rows = append(rows, total)
	rows[0].GroupTitle = reportAllSchoolsGroup
	return rows
}

// keyDateDistrictRows prints the schools of each Sozialraum under its title
// and its sum after them.
func keyDateDistrictRows(report traegerview.KeyDateReport) []lists.Row {
	var rows []lists.Row
	for _, district := range report.Districts {
		title := lists.SanitizeUserText(district.Name)
		for _, school := range report.Schools {
			if schoolDistrict(school) != district.Name {
				continue
			}
			row := keyDateFigureRow(school.Name, school.City, district.Name, report.Sections, school.Figures)
			row.GroupTitle, title = title, ""
			rows = append(rows, row)
		}
		rows = append(rows, keyDateFigureRow(reportSumLabel+district.Name, "", district.Name, report.Sections, district.Figures))
	}
	return rows
}

// keyDateCareFormRows prints the block of the children per care form: a row
// per school and form, the children of each school without one, and the
// forms of all schools summed by name.
func keyDateCareFormRows(report traegerview.KeyDateReport, grouped bool) []lists.Row {
	var rows []lists.Row
	add := func(school, city string, district *string, form string, children int, capacity *int) {
		values := map[lists.ColumnID]string{
			reportColumnSchool: lists.SanitizeUserText(school), reportColumnCity: lists.SanitizeUserText(city),
			reportColumnCareForm: lists.SanitizeUserText(form), reportColumnChildren: strconv.Itoa(children),
		}
		if grouped && district != nil {
			values[reportColumnDistrict] = lists.SanitizeUserText(*district)
		}
		if capacity != nil {
			values[reportColumnPlaces] = strconv.Itoa(*capacity)
		}
		row := lists.Row{Values: values}
		if len(rows) == 0 {
			row.GroupTitle = reportCareFormGroup
		}
		rows = append(rows, row)
	}
	for _, school := range report.Schools {
		district := school.District
		if grouped && district == nil {
			unmapped := traegerview.UnmappedDistrict
			district = &unmapped
		}
		for _, form := range school.CareForms {
			add(school.Name, school.City, district, form.Name, form.Children, form.Capacity)
		}
		add(school.Name, school.City, district, reportWithoutCareFormLabel, school.Figures.WithoutCareForm, nil)
	}
	for _, form := range report.Total.CareForms {
		add(reportTotalLabel, "", nil, form.Name, form.Children, form.Capacity)
	}
	add(reportTotalLabel, "", nil, reportWithoutCareFormLabel, report.Total.Figures.WithoutCareForm, nil)
	return rows
}

func schoolDistrict(school traegerview.KeyDateSchool) string {
	if school.District == nil {
		return traegerview.UnmappedDistrict
	}
	return *school.District
}

// keyDateFigureRow prints the figures of the sections of one school, one
// Sozialraum or the total.
func keyDateFigureRow(name, city, district string, sections []string, figures traegerview.KeyDateFigures) lists.Row {
	values := map[lists.ColumnID]string{
		reportColumnSchool: lists.SanitizeUserText(name),
		reportColumnCity:   lists.SanitizeUserText(city),
	}
	if district != "" {
		values[reportColumnDistrict] = lists.SanitizeUserText(district)
	}
	figure := func(section string, column lists.ColumnID, value string) {
		if slices.Contains(sections, section) {
			values[column] = value
		}
	}
	figure(traegerview.ReportSectionChildren, reportColumnChildren, strconv.Itoa(figures.Children))
	figure(traegerview.ReportSectionChildren, reportColumnWithoutForm, strconv.Itoa(figures.WithoutCareForm))
	figure(traegerview.ReportSectionStaff, reportColumnStaff, strconv.Itoa(figures.Staff))
	figure(traegerview.ReportSectionStaff, reportColumnPerStaff, germanDecimal(figures.ChildrenPerStaff))
	figure(traegerview.ReportSectionAbsences, reportColumnPresent, strconv.Itoa(figures.PresentDays))
	figure(traegerview.ReportSectionAbsences, reportColumnSick, strconv.Itoa(figures.SickDays))
	figure(traegerview.ReportSectionAbsences, reportColumnExcused, strconv.Itoa(figures.ExcusedDays))
	figure(traegerview.ReportSectionAbsences, reportColumnAbsenceRate, germanDecimal(figures.AbsenceRate))
	figure(traegerview.ReportSectionDemand, reportColumnPlaces, strconv.Itoa(figures.Places))
	figure(traegerview.ReportSectionDemand, reportColumnBookedPlaces, strconv.Itoa(figures.BookedPlaces))
	figure(traegerview.ReportSectionDemand, reportColumnFreePlaces, strconv.Itoa(figures.FreePlaces))
	figure(traegerview.ReportSectionDemand, reportColumnOpen, strconv.Itoa(figures.Open))
	figure(traegerview.ReportSectionDemand, reportColumnWaitlisted, strconv.Itoa(figures.Waitlisted))
	figure(traegerview.ReportSectionDemand, reportColumnDemand, strconv.Itoa(figures.Demand))
	return lists.Row{Values: values}
}

// germanDecimal prints a value with one decimal and a decimal comma; a
// missing value stays empty, so a spreadsheet never reads it as 0.
func germanDecimal(value *float64) string {
	if value == nil {
		return ""
	}
	return strings.Replace(strconv.FormatFloat(*value, 'f', 1, 64), ".", ",", 1)
}
