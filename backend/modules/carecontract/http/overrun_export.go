package carecontracthttp

import (
	"fmt"
	"strconv"

	"github.com/moto-ogs/project-phoenix/modules/carecontract"
)

// overrunHead is the head both overrun exports share: the window, the school
// and the tolerance the evaluation applied.
func overrunHead(result carecontract.OverrunEvaluation, filter carecontract.OverrunFilter) (string, []string) {
	from, to := result.From.Format("02.01.2006"), result.To.Format("02.01.2006")
	schoolName := ""
	for _, school := range result.Schools {
		if school.SchoolID == filter.SchoolID {
			schoolName = school.SchoolName
		}
	}
	return from + " bis " + to, []string{
		schoolFilterLabel(filter.SchoolID, schoolName), "Zeitraum: " + from + " bis " + to,
		"Toleranz: " + strconv.Itoa(result.ToleranceMinutes) + " Minuten",
	}
}

// overrunSchoolsTable is one row per school with its figures, then the
// total of every school of the filter.
func overrunSchoolsTable(result carecontract.OverrunEvaluation, filter carecontract.OverrunFilter) ListTable {
	subtitle, filters := overrunHead(result, filter)
	rows := make([][]string, 0, len(result.Schools)+1)
	for _, school := range result.Schools {
		dataFrom := ""
		if !school.DataFrom.IsZero() {
			dataFrom = school.DataFrom.Format("02.01.2006")
		}
		rows = append(rows, append([]string{school.SchoolName}, overrunFigures(school.Figures, dataFrom, school.ComparedDays)...))
	}
	if filter.SchoolID == 0 && len(result.Schools) > 1 {
		rows = append(rows, append([]string{"Alle Schulen"}, overrunFigures(result.Total, "", -1)...))
	}
	return ListTable{
		Title: "Länger als gebucht", Subtitle: subtitle, Filters: filters,
		Columns: []ListColumn{
			{ID: "school", Label: "Schule"}, {ID: "children", Label: "Kinder"}, {ID: "overrun_days", Label: "Tage länger als gebucht"},
			{ID: "unbooked_days", Label: "Tage ohne Buchung"}, {ID: "extra", Label: "Zusätzliche Zeit"},
			{ID: "data_from", Label: "Daten ab"}, {ID: "compared_days", Label: "Verglichene Tage"},
		},
		Rows: rows, Filename: fmt.Sprintf("laenger-als-gebucht-%s-bis-%s", result.From, result.To),
	}
}

// overrunFigures writes the figures; compared below 0 leaves the compared
// days empty (the total).
func overrunFigures(figures carecontract.OverrunFigures, dataFrom string, compared int) []string {
	comparedDays := ""
	if compared >= 0 {
		comparedDays = strconv.Itoa(compared)
	}
	return []string{
		strconv.Itoa(figures.Children), strconv.Itoa(figures.OverrunDays), strconv.Itoa(figures.UnbookedDays),
		overrunDuration(figures.ExtraMinutes), dataFrom, comparedDays,
	}
}

// overrunChildrenTable is one row per child with an overrun.
func overrunChildrenTable(result carecontract.OverrunEvaluation, filter carecontract.OverrunFilter) ListTable {
	subtitle, filters := overrunHead(result, filter)
	rows := make([][]string, 0, len(result.Children))
	for _, child := range result.Children {
		rows = append(rows, []string{
			child.LastName, child.FirstName, child.SchoolClass, child.SchoolName,
			strconv.Itoa(child.OverrunDays), strconv.Itoa(child.UnbookedDays), overrunDuration(child.ExtraMinutes),
		})
	}
	return ListTable{
		Title: "Länger als gebucht: Kinder", Subtitle: subtitle, Filters: filters,
		Columns: []ListColumn{
			{ID: "last_name", Label: "Nachname"}, {ID: "first_name", Label: "Vorname"}, {ID: "class", Label: "Klasse"},
			{ID: "school", Label: "Schule"}, {ID: "overrun_days", Label: "Tage länger als gebucht"},
			{ID: "unbooked_days", Label: "Tage ohne Buchung"}, {ID: "extra", Label: "Zusätzliche Zeit"},
		},
		Rows: rows, Footer: personalDataFooter,
		Filename: fmt.Sprintf("laenger-als-gebucht-kinder-%s-bis-%s", result.From, result.To),
	}
}

// overrunDuration is „2:05 Std.“ for 125 minutes.
func overrunDuration(minutes int) string {
	return fmt.Sprintf("%d:%02d Std.", minutes/60, minutes%60)
}
