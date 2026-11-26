// Package reportexport renders the key-date report of the Träger projection
// (#4716, ADR 0246) as a PDF, XLSX or CSV file through the list contract of
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

// The export of the key-date report (#4716, ADR 0246) has two layouts.
//
//   - Excel and CSV are one table for a spreadsheet: a row per school,
//     grouped by Sozialraum with a sum row per Sozialraum and a last row
//     "Gesamt", then, when the report shows the children, a block "Kinder
//     je Betreuungsform" with a row per school and care form. Its columns
//     follow the sections of the report.
//   - The PDF is read by people at Jugendamt and Kommune, and a table of up
//     to 18 columns breaks every heading on a page. It prints a card per
//     school with the figures of each section, its care forms below, grouped
//     by Sozialraum with a card for the sum of each, and a last card
//     "Gesamt".
//
// Every name comes from the Träger-Büro or the schools and is sanitized
// before the renderer sees it; the CSV renderer keeps a cell from being read
// as a formula.

// The columns of the export.
const (
	reportColumnSchool         lists.ColumnID = "school"
	reportColumnCity           lists.ColumnID = "city"
	reportColumnDistrict       lists.ColumnID = "district"
	reportColumnCareForm       lists.ColumnID = "care_form"
	reportColumnChildren       lists.ColumnID = "children"
	reportColumnWithoutForm    lists.ColumnID = "without_care_form"
	reportColumnStaff          lists.ColumnID = "staff"
	reportColumnPerStaff       lists.ColumnID = "children_per_staff"
	reportColumnPresent        lists.ColumnID = "present_days"
	reportColumnSick           lists.ColumnID = "sick_days"
	reportColumnExcused        lists.ColumnID = "excused_days"
	reportColumnAbsenceRate    lists.ColumnID = "absence_rate"
	reportColumnPlaces         lists.ColumnID = "places"
	reportColumnBookedPlaces   lists.ColumnID = "booked_places"
	reportColumnFreePlaces     lists.ColumnID = "free_places"
	reportColumnOpen           lists.ColumnID = "open"
	reportColumnWaitlisted     lists.ColumnID = "waitlisted"
	reportColumnDemand         lists.ColumnID = "demand"
	reportColumnKeyDate        lists.ColumnID = "key_date"
	reportColumnDemandAsOf     lists.ColumnID = "demand_as_of"
	reportColumnAbsenceFrom    lists.ColumnID = "absence_from"
	reportColumnAbsenceTo      lists.ColumnID = "absence_to"
	reportColumnAttendanceFrom lists.ColumnID = "attendance_from"
	reportColumnAttendanceNote lists.ColumnID = "attendance_note"
)

// The labels of the rows and blocks the export adds.
const (
	reportTotalLabel           = "Gesamt"
	reportSumLabel             = "Summe "
	reportAllSchoolsGroup      = "Alle Standorte"
	reportCareFormGroup        = "Kinder pro Betreuungsform"
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
		{ID: reportColumnPerStaff, Label: "Kinder pro Person"},
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
	lists lists.DocumentRenderer
}

// New builds the renderer.
func New() Renderer {
	return Renderer{lists: lists.NewRendererService()}
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
	base := "bericht-stichtag-" + report.KeyDate.String()
	var file lists.File
	var err error
	if listFormat == lists.FormatPDF {
		file, err = r.lists.RenderRecords(keyDateReportRecords(report), base)
	} else {
		file, err = r.lists.Render(keyDateReportDocument(report), listFormat, base)
	}
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
	// CSV omits document headings and filters. Keep reference dates in the
	// data itself, also on subtotal and care-form rows copied elsewhere.
	for _, row := range doc.Rows {
		if len(row.Values) == 0 {
			continue
		}
		row.Values[reportColumnKeyDate] = report.KeyDate.String()
		if slices.Contains(report.Sections, traegerview.ReportSectionDemand) {
			row.Values[reportColumnDemandAsOf] = calendar.DateFromTime(report.AsOf).String()
		}
		if report.AbsenceWindow != nil {
			row.Values[reportColumnAbsenceFrom] = report.AbsenceWindow.From.String()
			row.Values[reportColumnAbsenceTo] = report.AbsenceWindow.To.String()
		}
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
		header = append(header, "Fehlzeiten zählen nur Tage mit gespeicherten Check-ins.")
		for _, school := range report.Schools {
			if attendanceNote(report, school) != "" {
				header = append(header, "Bei Schulen mit Datenlücken sind die Fehlzeiten unvollständig.")
				break
			}
		}
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
	columns = append(columns, lists.Column{ID: reportColumnKeyDate, Label: "Stichtag"})
	for _, section := range traegerview.ReportSections() {
		if slices.Contains(sections, section) {
			columns = append(columns, reportSectionColumns[section]...)
		}
	}
	// The block of care forms prints the places of each form.
	if children && !slices.Contains(sections, traegerview.ReportSectionDemand) {
		columns = append(columns, lists.Column{ID: reportColumnPlaces, Label: "Plätze"})
	}
	if slices.Contains(sections, traegerview.ReportSectionDemand) {
		columns = append(columns, lists.Column{ID: reportColumnDemandAsOf, Label: "Anmeldungen Stand"})
	}
	if slices.Contains(sections, traegerview.ReportSectionAbsences) {
		columns = append(columns,
			lists.Column{ID: reportColumnAbsenceFrom, Label: "Fehlzeiten von"},
			lists.Column{ID: reportColumnAbsenceTo, Label: "Fehlzeiten bis"},
			lists.Column{ID: reportColumnAttendanceFrom, Label: "Check-ins ab"},
			lists.Column{ID: reportColumnAttendanceNote, Label: "Datenumfang"},
		)
	}
	return columns
}

// keyDateSchoolRows prints a row per school, per Sozialraum its sum and the
// total last.
func keyDateSchoolRows(report traegerview.KeyDateReport, grouped bool) []lists.Row {
	total := keyDateFigureRow(reportTotalLabel, "", "", report.Sections, report.Total.Figures)
	if grouped {
		return append(keyDateDistrictRows(report), lists.Row{GroupTitle: reportTotalLabel}, total)
	}
	// A row that opens a group is only its title: the renderers print no
	// values of it, so every title stands in a row of its own.
	rows := []lists.Row{{GroupTitle: reportAllSchoolsGroup}}
	for _, school := range report.Schools {
		rows = append(rows, keyDateSchoolRow(report, school, ""))
	}
	return append(rows, total)
}

// keyDateDistrictRows prints the schools of each Sozialraum under its title
// and its sum after them.
func keyDateDistrictRows(report traegerview.KeyDateReport) []lists.Row {
	var rows []lists.Row
	for _, district := range report.Districts {
		rows = append(rows, lists.Row{GroupTitle: lists.SanitizeUserText(district.Name)})
		for _, school := range report.Schools {
			if !schoolInDistrict(school, district) {
				continue
			}
			rows = append(rows, keyDateSchoolRow(report, school, district.Name))
		}
		rows = append(rows, keyDateFigureRow(reportSumLabel+district.Name, "", district.Name, report.Sections, district.Figures))
	}
	return rows
}

// keyDateCareFormRows prints the block of the children per care form: a row
// per school and form, the children of each school without one, and the
// forms of all schools summed by name.
func keyDateCareFormRows(report traegerview.KeyDateReport, grouped bool) []lists.Row {
	rows := []lists.Row{{GroupTitle: reportCareFormGroup}}
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
		rows = append(rows, lists.Row{Values: values})
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

func schoolInDistrict(school traegerview.KeyDateSchool, district traegerview.KeyDateDistrict) bool {
	if school.District == nil {
		return district.Unmapped
	}
	return !district.Unmapped && *school.District == district.Name
}

func keyDateSchoolRow(report traegerview.KeyDateReport, school traegerview.KeyDateSchool, district string) lists.Row {
	row := keyDateFigureRow(school.Name, school.City, district, report.Sections, school.Figures)
	if slices.Contains(report.Sections, traegerview.ReportSectionAbsences) {
		if school.AttendanceFrom != nil {
			row.Values[reportColumnAttendanceFrom] = school.AttendanceFrom.String()
		}
		row.Values[reportColumnAttendanceNote] = attendanceNote(report, school)
	}
	return row
}

func attendanceNote(report traegerview.KeyDateReport, school traegerview.KeyDateSchool) string {
	if report.AbsenceWindow == nil {
		return ""
	}
	if school.AttendanceFrom == nil || school.AttendanceFrom.After(report.AbsenceWindow.To) {
		return "Keine Check-ins im Zeitraum gespeichert."
	}
	if school.AttendanceFrom.After(report.AbsenceWindow.From) {
		return "Check-ins sind erst ab " + school.AttendanceFrom.Format("02.01.2006") + " gespeichert. Frühere Tage fehlen."
	}
	return ""
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

// keyDateReportRecords lays the report out as cards for the PDF: a group per
// Sozialraum (or one group of all schools) with a card per school and a card
// for the sum of the Sozialraum, and a last group with the card "Gesamt".
func keyDateReportRecords(report traegerview.KeyDateReport) lists.RecordDocument {
	doc := lists.RecordDocument{
		Title:       "Bericht zum Stichtag " + report.KeyDate.Format("02.01.2006"),
		GeneratedAt: report.AsOf,
		Filters:     keyDateReportHeader(report),
		Footer:      "Zusammengefasste Zahlen ohne Namen von Kindern oder Personal.",
	}
	if report.Template != nil {
		doc.Subtitle = lists.SanitizeUserText(report.Template.Name)
	}
	doc.Groups = keyDateSchoolGroups(report)
	doc.Groups = append(doc.Groups, lists.RecordGroup{
		Title:   reportTotalLabel,
		Records: []lists.Record{keyDateRecord(reportTotalLabel+" ("+schoolCount(report.Total.Schools)+")", report.Sections, report.Total.Figures, report.Total.CareForms)},
	})
	return doc
}

// keyDateSchoolGroups prints the cards of the schools: one group of all
// schools without a Sozialraum, else a group per Sozialraum closed by its sum.
func keyDateSchoolGroups(report traegerview.KeyDateReport) []lists.RecordGroup {
	if len(report.Districts) == 0 {
		group := lists.RecordGroup{Title: reportAllSchoolsGroup}
		for _, school := range report.Schools {
			group.Records = append(group.Records, keyDateSchoolRecord(report, school))
		}
		return []lists.RecordGroup{group}
	}
	groups := make([]lists.RecordGroup, 0, len(report.Districts))
	for _, district := range report.Districts {
		group := lists.RecordGroup{Title: lists.SanitizeUserText(district.Name)}
		for _, school := range report.Schools {
			if schoolInDistrict(school, district) {
				group.Records = append(group.Records, keyDateSchoolRecord(report, school))
			}
		}
		group.Records = append(group.Records, keyDateRecord(reportSumLabel+district.Name, report.Sections, district.Figures, district.CareForms))
		groups = append(groups, group)
	}
	return groups
}

func keyDateSchoolRecord(report traegerview.KeyDateReport, school traegerview.KeyDateSchool) lists.Record {
	title := school.Name
	if school.City != "" {
		title += ", " + school.City
	}
	record := keyDateRecord(title, report.Sections, school.Figures, school.CareForms)
	if !slices.Contains(report.Sections, traegerview.ReportSectionAbsences) || report.AbsenceWindow == nil {
		return record
	}
	from := "–"
	if school.AttendanceFrom != nil {
		from = school.AttendanceFrom.Format("02.01.2006")
	}
	record.Fields = append(record.Fields, lists.Field{Label: "Check-ins ab", Value: from})
	if note := attendanceNote(report, school); note != "" {
		record.Fields = append(record.Fields, lists.Field{Label: "Datenumfang", Value: note})
	}
	return record
}

// keyDateRecord is one card: a line per section of the report and, with the
// children, a block of the care forms.
func keyDateRecord(title string, sections []string, figures traegerview.KeyDateFigures, careForms []traegerview.KeyDateCareForm) lists.Record {
	record := lists.Record{Title: lists.SanitizeUserText(title)}
	for _, section := range traegerview.ReportSections() {
		if slices.Contains(sections, section) {
			record.Fields = append(record.Fields, sectionFields(section, figures)...)
		}
	}
	if slices.Contains(sections, traegerview.ReportSectionChildren) && len(careForms) > 0 {
		record.Subs = append(record.Subs, careFormBlock(careForms))
	}
	return record
}

// sectionFields are the lines of one section on a card.
func sectionFields(section string, figures traegerview.KeyDateFigures) []lists.Field {
	switch section {
	case traegerview.ReportSectionChildren:
		return []lists.Field{{Label: "Kinder", Value: strconv.Itoa(figures.Children) + " · davon ohne Betreuungsform " + strconv.Itoa(figures.WithoutCareForm)}}
	case traegerview.ReportSectionStaff:
		return []lists.Field{{Label: "Personal", Value: strconv.Itoa(figures.Staff) + " · " + decimalOrDash(figures.ChildrenPerStaff, "") + " Kinder pro Person"}}
	case traegerview.ReportSectionAbsences:
		return []lists.Field{{Label: "Fehlzeiten", Value: strconv.Itoa(figures.PresentDays) + " Tage anwesend · " + strconv.Itoa(figures.SickDays) + " krank · " +
			strconv.Itoa(figures.ExcusedDays) + " entschuldigt · Fehlquote " + decimalOrDash(figures.AbsenceRate, " %")}}
	case traegerview.ReportSectionDemand:
		places := "keine Platzgrenze"
		if figures.Places > 0 {
			places = strconv.Itoa(figures.BookedPlaces) + " von " + strconv.Itoa(figures.Places) + " belegt · " + strconv.Itoa(figures.FreePlaces) + " frei"
		}
		return []lists.Field{
			{Label: "Plätze", Value: places},
			{Label: "Nachfrage", Value: strconv.Itoa(figures.Demand) + " · davon " + strconv.Itoa(figures.Open) + " offene Anmeldungen und " +
				strconv.Itoa(figures.Waitlisted) + " auf der Warteliste"},
		}
	}
	return nil
}

// careFormBlock lists the children and places of each care form.
func careFormBlock(careForms []traegerview.KeyDateCareForm) lists.SubRecord {
	sub := lists.SubRecord{Title: reportCareFormGroup}
	for _, form := range careForms {
		value := strconv.Itoa(form.Children) + " Kinder"
		if form.Capacity != nil {
			value += " von " + strconv.Itoa(*form.Capacity) + " Plätzen"
		}
		sub.Fields = append(sub.Fields, lists.Field{Label: lists.SanitizeUserText(form.Name), Value: value})
	}
	return sub
}

// decimalOrDash prints a value with one decimal and the suffix, "–" without one.
func decimalOrDash(value *float64, suffix string) string {
	if value == nil {
		return "–"
	}
	return germanDecimal(value) + suffix
}

func schoolCount(count int) string {
	if count == 1 {
		return "1 Schule"
	}
	return strconv.Itoa(count) + " Schulen"
}
