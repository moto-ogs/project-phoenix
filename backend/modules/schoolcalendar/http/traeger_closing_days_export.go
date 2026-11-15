package staffcalendarhttp

import (
	"net/http"
	"slices"
	"strconv"
	"strings"

	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/modules/schoolcalendar/traegercalendar"
)

// export answers GET /traeger/closing-days/export?from=YYYY-MM-DD&to=YYYY-MM-DD:
// the closing days of the window as PDF, Excel or CSV (format=, CSV without
// one), the earliest first like the list, with the schools each holds for
// (#4718). Closing days name no person, so the export is not written to a
// log, like the list.
func (rs *TraegerClosingDayResource) export(w http.ResponseWriter, r *http.Request) {
	format, ok := common.ListFormatOf(w, r)
	if !ok {
		return
	}
	organizationID, ok := traegerOf(w, r)
	if !ok {
		return
	}
	result, from, to, ok := rs.readCalendar(w, r, organizationID)
	if !ok {
		return
	}
	days := slices.Clone(result.ClosingDays)
	slices.SortStableFunc(days, func(a, b traegercalendar.ClosingDay) int { return a.StartDate.Compare(b.StartDate) })
	rows := make([][]string, 0, len(days))
	for _, day := range days {
		rows = append(rows, []string{
			day.StartDate.Format("02.01.2006"), day.EndDate.Format("02.01.2006"), strconv.Itoa(day.StartDate.DaysUntil(day.EndDate) + 1),
			day.Reason, closingDaySchools(day, result.Schools),
		})
	}
	common.WriteList(w, r, rs.lists, format, common.ListTable{
		Title:   "Schließtage",
		Filters: []string{common.ListPeriodLabel(from.Format("02.01.2006"), to.Format("02.01.2006")), common.ListSchoolLabel("")},
		Columns: []common.ListColumn{
			{ID: "start", Label: "Von"}, {ID: "end", Label: "Bis"}, {ID: "days", Label: "Tage"},
			{ID: "reason", Label: "Grund"}, {ID: "schools", Label: "Gilt für"},
		},
		Rows: rows, Filename: "schliesstage-" + from.String() + "-bis-" + to.String(),
	})
}

// closingDaySchools is „Alle Schulen“ or the names of the schools the day
// holds for, as the list names them.
func closingDaySchools(day traegercalendar.ClosingDay, schools []traegercalendar.School) string {
	names := make([]string, 0, len(day.SchoolIDs))
	for _, school := range schools {
		if slices.Contains(day.SchoolIDs, school.ID) {
			names = append(names, school.Name)
		}
	}
	if len(schools) > 0 && len(names) == len(schools) {
		return "Alle Schulen"
	}
	return strings.Join(names, ", ")
}
