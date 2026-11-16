package traegerviewhttp

import (
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/modules/traegerview"
)

// listSchoolsExport answers GET /traeger/schools/export: the schools of the
// Träger of the session as PDF, Excel or CSV (format=, CSV without one),
// one row per school (#4718). School names are no personal data, so the
// export is not written to the access log, like the list.
func (rs *Resource) listSchoolsExport(w http.ResponseWriter, r *http.Request) {
	format, ok := common.ListFormatOf(w, r)
	if !ok {
		return
	}
	principal, err := common.CurrentPrincipal(r.Context())
	if err != nil || principal.OrganizationID() <= 0 {
		common.RenderError(w, r, common.ErrorUnauthorized(common.ErrUnauthorized))
		return
	}
	schools, err := rs.overview.Schools(r.Context(), principal.OrganizationID())
	switch {
	case errors.Is(err, traegerview.ErrTraegerUnavailable):
		common.RenderError(w, r, common.ErrorUnauthorized(common.ErrUnauthorized))
		return
	case err != nil:
		common.RenderError(w, r, common.ErrorInternalServer(err))
		return
	}
	rows := make([][]string, 0, len(schools))
	for _, school := range schools {
		rows = append(rows, []string{school.Name, school.City})
	}
	common.WriteList(w, r, rs.lists, format, common.ListTable{
		Title: "Schulen", Filters: []string{common.ListSchoolLabel("")},
		Columns: []common.ListColumn{{ID: "school", Label: "Schule"}, {ID: "city", Label: "Ort"}},
		Rows:    rows, Filename: "schulen",
	})
}

// schoolsAlertsExport answers GET /traeger/schools/alerts/export: the
// figures of the dashboard and its hints as PDF, Excel or CSV (format=, CSV
// without one), one row per school, for every school or one (school=ID)
// (#4718). A school of another Träger and an unknown ID answer 404
// traeger.school_not_found. The figures are aggregated numbers, so the
// export is not written to the access log, like the list.
func (rs *Resource) schoolsAlertsExport(w http.ResponseWriter, r *http.Request) {
	format, schoolID, ok := readExportOptions(w, r)
	if !ok {
		return
	}
	principal, err := common.CurrentPrincipal(r.Context())
	if err != nil || principal.OrganizationID() <= 0 {
		common.RenderError(w, r, common.ErrorUnauthorized(common.ErrUnauthorized))
		return
	}
	alerts, err := rs.overview.SchoolsAlerts(r.Context(), principal.OrganizationID())
	switch {
	case errors.Is(err, traegerview.ErrTraegerUnavailable):
		common.RenderError(w, r, common.ErrorUnauthorized(common.ErrUnauthorized))
		return
	case err != nil:
		common.RenderError(w, r, common.ErrorInternalServer(err))
		return
	}
	schoolName := ""
	if schoolID > 0 {
		school, found := findSchool(alerts.Schools, schoolID, func(s traegerview.SchoolAlerts) traegerview.School { return s.School })
		if !found {
			renderSchoolNotFound(w, r)
			return
		}
		alerts.Schools, schoolName = []traegerview.SchoolAlerts{school}, school.Name
	}
	common.WriteList(w, r, rs.lists, format, schoolsAlertsTable(alerts, schoolName))
}

// alertLabels are the hints as the dashboard names them.
var alertLabels = map[string]string{
	traegerview.AlertStaffShortage:   "Zu wenig Personal",
	traegerview.AlertSickChildren:    "Viele Krankmeldungen",
	traegerview.AlertOpenEnrollments: "Offene Anmeldungen",
}

// schoolsAlertsTable is one row per school: its figures of now and the
// hints that reach a threshold of the Träger.
func schoolsAlertsTable(alerts traegerview.SchoolsAlerts, schoolName string) common.ListTable {
	asOf := alerts.AsOf.In(berlin)
	rows := make([][]string, 0, len(alerts.Schools))
	for _, school := range alerts.Schools {
		figures := school.Figures
		hints := make([]string, 0, len(school.Alerts))
		for _, kind := range school.Alerts {
			hints = append(hints, alertLabels[kind])
		}
		rows = append(rows, []string{
			school.Name, school.City, strconv.Itoa(figures.ChildrenTotal), strconv.Itoa(figures.ChildrenPresent),
			strconv.Itoa(figures.ChildrenSick), strconv.Itoa(figures.StaffPresent), strconv.Itoa(figures.StaffTotal),
			careRatioLabel(figures.CareRatio), strconv.Itoa(school.OpenEnrollments), strings.Join(hints, ", "),
		})
	}
	return common.ListTable{
		Title: "Dashboard", Subtitle: "Stand " + asOf.Format("02.01.2006, 15:04") + " Uhr",
		Filters: []string{common.ListSchoolLabel(schoolName)},
		Columns: []common.ListColumn{
			{ID: "school", Label: "Schule"}, {ID: "city", Label: "Ort"}, {ID: "children", Label: "Kinder gesamt"},
			{ID: "present", Label: "Jetzt anwesend"}, {ID: "sick", Label: "Heute krank"},
			{ID: "staff_present", Label: "Betreuungskräfte anwesend"}, {ID: "staff_total", Label: "Betreuungskräfte gesamt"},
			{ID: "ratio", Label: "Schlüssel"}, {ID: "enrollments", Label: "Offene Anmeldungen"}, {ID: "alerts", Label: "Auffälligkeiten"},
		},
		Rows: rows, Filename: "dashboard-" + asOf.Format("2006-01-02"),
	}
}

// careRatioLabel is „1 : 8,5“ or „1 : 8“ as on the dashboard, empty
// without present staff.
func careRatioLabel(ratio *float64) string {
	if ratio == nil {
		return ""
	}
	return "1 : " + strings.TrimSuffix(strings.Replace(strconv.FormatFloat(*ratio, 'f', 1, 64), ".", ",", 1), ",0")
}
