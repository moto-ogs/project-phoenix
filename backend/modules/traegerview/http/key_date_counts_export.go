package traegerviewhttp

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/modules/traegerview"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// keyDateCountsExport answers GET /traeger/schools/key-date-counts/export:
// the captured Stichtagszahlen as PDF, Excel or CSV (format=, CSV without
// one), for every school or one (school=ID) (#4718). For every school the
// sum of each month comes first, then one row per school and month. A
// school of another Träger and an unknown ID answer 404
// traeger.school_not_found. The rows are aggregated numbers, so the export
// is not written to the access log, like the list (ADR 0084 section 7).
func (rs *Resource) keyDateCountsExport(w http.ResponseWriter, r *http.Request) {
	format, schoolID, ok := readExportOptions(w, r)
	if !ok {
		return
	}
	principal, err := common.CurrentPrincipal(r.Context())
	if err != nil || principal.OrganizationID() <= 0 {
		common.RenderError(w, r, common.ErrorUnauthorized(common.ErrUnauthorized))
		return
	}
	counts, err := rs.overview.KeyDateCounts(r.Context(), principal.OrganizationID())
	switch {
	case errors.Is(err, traegerview.ErrTraegerUnavailable):
		common.RenderError(w, r, common.ErrorUnauthorized(common.ErrUnauthorized))
		return
	case err != nil:
		common.RenderError(w, r, common.ErrorInternalServer(err))
		return
	}
	if schoolID == 0 {
		common.WriteList(w, r, rs.lists, format, keyDateCountsTable(counts, ""))
		return
	}
	school, found := findSchool(counts.Schools, schoolID, func(s traegerview.SchoolKeyDateCounts) traegerview.TraegerSchool { return s.TraegerSchool })
	if !found {
		renderSchoolNotFound(w, r)
		return
	}
	counts.Schools, counts.Months = []traegerview.SchoolKeyDateCounts{school}, nil
	common.WriteList(w, r, rs.lists, format, keyDateCountsTable(counts, school.Name))
}

// keyDateCountsTable is one row per month for all schools together, then one
// row per school and captured month, newest month first. A row of all
// schools names how many schools have figures in that month.
func keyDateCountsTable(counts traegerview.KeyDateCounts, schoolName string) common.ListTable {
	var rows [][]string
	for _, month := range counts.Months {
		rows = append(rows, []string{
			keyDateMonthLabel(month.Period), month.KeyDate.Format("02.01.2006"), "Alle Schulen (" + strconv.Itoa(month.Schools) + ")", "",
			strconv.Itoa(month.ActiveStudents), strconv.Itoa(month.ActiveTerminals), "",
		})
	}
	for _, school := range counts.Schools {
		for _, count := range school.Counts {
			rows = append(rows, []string{
				keyDateMonthLabel(count.Period), count.KeyDate.Format("02.01.2006"), school.Name, school.City,
				strconv.Itoa(count.ActiveStudents), strconv.Itoa(count.ActiveTerminals), count.RecordedAt.In(berlin).Format("02.01.2006"),
			})
		}
	}
	return common.ListTable{
		Title: "Stichtagszahlen", Filters: []string{common.ListSchoolLabel(schoolName)},
		Columns: []common.ListColumn{
			{ID: "month", Label: "Monat"}, {ID: "key_date", Label: "Stichtag"}, {ID: "school", Label: "Schule"},
			{ID: "city", Label: "Ort"}, {ID: "children", Label: "Aktive Kinder", Numeric: true}, {ID: "terminals", Label: "Aktive Geräte", Numeric: true},
			{ID: "recorded", Label: "Festgehalten am"},
		},
		Rows: rows, Filename: "stichtagszahlen",
	}
}

var germanMonths = [...]string{"", "Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"}

// keyDateMonthLabel is „September 2026“.
func keyDateMonthLabel(period calendar.Date) string {
	return germanMonths[period.Month()] + " " + strconv.Itoa(period.Year())
}
