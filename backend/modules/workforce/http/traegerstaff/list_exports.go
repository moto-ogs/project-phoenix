package traegerstaff

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/modules/workforce"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// The downloads of the Personalakten and of the Einsatzplanung as PDF,
// Excel or CSV (#4718). Each reads the same data as its page through the
// same owner call, which writes the access entry of the export view at every
// school whose people it shows before the file is built; a failed entry
// leaves no file. No export holds bank or tax values.

// overviewExport answers the records of the list, one row per record.
func (rs *RecordsResource) overviewExport(w http.ResponseWriter, r *http.Request) {
	session, ok := actor(w, r)
	if !ok {
		return
	}
	format, ok := common.ListFormatOf(w, r)
	if !ok {
		return
	}
	overview, err := rs.records.Overview(r.Context(), session, workforce.TraegerStaffViewOverviewExport)
	if err != nil {
		renderError(w, r, err)
		return
	}
	common.WriteList(w, r, rs.lists, format, recordListTable(overview))
}

// recordListTable names no day of its own: the head of the file carries the
// moment it was made.
func recordListTable(overview workforce.TraegerStaffOverview) common.ListTable {
	rows := make([][]string, 0, len(overview.Records))
	for _, record := range overview.Records {
		number := ""
		if record.PersonnelNumber != nil {
			number = *record.PersonnelNumber
		}
		sites := make([]string, 0, len(record.Employments))
		for _, employment := range record.Employments {
			if employment.Active {
				sites = append(sites, employment.SchoolName)
			} else {
				sites = append(sites, employment.SchoolName+" (beendet)")
			}
		}
		rows = append(rows, []string{record.LastName, record.FirstName, germanDay(record.Birthday), number, strings.Join(sites, ", ")})
	}
	return common.ListTable{
		Title: "Personalakten", Subtitle: "Alle Akten mit ihren Einsatzorten",
		Filters: []string{common.ListSchoolLabel("")},
		Columns: []common.ListColumn{
			{ID: "last_name", Label: "Nachname"}, {ID: "first_name", Label: "Vorname"}, {ID: "birthday", Label: "Geburtsdatum"},
			{ID: "personnel_number", Label: "Personalnummer"}, {ID: "schools", Label: "Einsatzorte"},
		},
		Rows: rows, Footer: common.ListPersonalDataFooter,
		Filename: "personalakten",
	}
}

// weekExport answers the shown week, one row per person with a column per
// day from Monday to Sunday.
func (rs *PlanningResource) weekExport(w http.ResponseWriter, r *http.Request) {
	session, ok := actor(w, r)
	if !ok {
		return
	}
	format, ok := common.ListFormatOf(w, r)
	if !ok {
		return
	}
	weekStart, ok := weekParam(w, r)
	if !ok {
		return
	}
	week, err := rs.planning.PlanningWeek(r.Context(), session, weekStart, workforce.TraegerStaffViewPlanningExport)
	if err != nil {
		renderPlanningError(w, r, err)
		return
	}
	common.WriteList(w, r, rs.lists, format, planningWeekTable(week))
}

var planningWeekdays = [7]string{"Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"}

func planningWeekTable(week workforce.TraegerPlanningWeek) common.ListTable {
	monday := week.WeekStart
	columns := []common.ListColumn{
		{ID: "week", Label: "Woche ab", SpreadsheetOnly: true},
		{ID: "last_name", Label: "Nachname"}, {ID: "first_name", Label: "Vorname"}, {ID: "schools", Label: "Einsatzorte"},
	}
	for i, weekday := range planningWeekdays {
		columns = append(columns, common.ListColumn{ID: "day_" + strconv.Itoa(i+1), Label: weekday + ", " + monday.AddDays(i).Format("02.01.")})
	}
	columns = append(columns, common.ListColumn{ID: "planned_hours", Label: "Geplant (Stunden)", Numeric: true},
		common.ListColumn{ID: "soll_hours", Label: "Soll (Stunden)", Numeric: true}, common.ListColumn{ID: "warnings", Label: "Hinweise", Numeric: true})
	rows := make([][]string, 0, len(week.People))
	for _, person := range week.People {
		rows = append(rows, planningPersonRow(person, monday))
	}
	filters := []string{common.ListSchoolLabel(""), common.ListPeriodLabel(monday.Format("02.01.2006"), monday.AddDays(6).Format("02.01.2006"))}
	if len(week.Unreached) > 0 {
		names := make([]string, 0, len(week.Unreached))
		for _, school := range week.Unreached {
			names = append(names, school.Name)
		}
		note := "Ohne die Schichten von: " + strings.Join(names, ", ")
		filters = append(filters, note)
		columns = append(columns, common.ListColumn{ID: "completeness", Label: "Vollständigkeit", SpreadsheetOnly: true})
		// Keep the warning in CSV even when no person could be loaded.
		if len(rows) == 0 {
			rows = append(rows, make([]string, len(columns)-1))
		}
		for i := range rows {
			rows[i] = append(rows[i], note)
		}
	}
	return common.ListTable{
		Title: "Einsatzplanung", Subtitle: "Woche vom " + monday.Format("02.01.2006"),
		Filters: filters, Columns: columns, Rows: rows, Footer: common.ListPersonalDataFooter,
		Filename: "einsatzplanung-" + monday.String(),
	}
}

func planningPersonRow(person workforce.TraegerPlanningPerson, monday calendar.Date) []string {
	sites := make([]string, 0, len(person.Sites))
	for _, site := range person.Sites {
		sites = append(sites, site.SchoolName)
	}
	days := make([][]string, len(planningWeekdays))
	for _, shift := range person.Shifts {
		index := monday.DaysUntil(shift.Date)
		if index < 0 || index >= len(days) {
			continue
		}
		entry := shift.StartTime + "–" + shift.EndTime + " " + shift.SchoolName
		if shift.Cancelled {
			entry += " (abgesagt)"
		}
		days[index] = append(days[index], entry)
	}
	row := []string{monday.Format("02.01.2006"), person.LastName, person.FirstName, strings.Join(sites, ", ")}
	for _, entries := range days {
		row = append(row, strings.Join(entries, "; "))
	}
	soll := ""
	if person.SollMinutes != nil {
		soll = germanHours(*person.SollMinutes)
	}
	return append(row, germanHours(person.PlannedMinutes), soll, strconv.Itoa(len(person.Warnings)))
}

// germanHours writes minutes as hours with a decimal comma: 270 is „4,5“.
func germanHours(minutes int) string {
	hours := strconv.FormatFloat(float64(minutes)/60, 'f', 2, 64)
	hours = strings.TrimSuffix(strings.TrimRight(hours, "0"), ".")
	return strings.Replace(hours, ".", ",", 1)
}
