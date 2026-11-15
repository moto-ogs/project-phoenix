package traegerviewhttp

import (
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/modules/traegerview"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// arrivalPickupTimes answers GET /traeger/schools/arrival-pickup-times: the
// heatmap of arrival and pickup times of every school of the Träger of the
// session between the days from and to (#4714). It holds averages, no child,
// so the read is not written to the access log (ADR 0084 section 7).
func (rs *Resource) arrivalPickupTimes(w http.ResponseWriter, r *http.Request) {
	times, ok := rs.readArrivalPickupTimes(w, r)
	if !ok {
		return
	}
	common.Respond(w, r, http.StatusOK, times, "Arrival and pickup times retrieved successfully")
}

// arrivalPickupTimesExport answers GET
// /traeger/schools/arrival-pickup-times/export: the same averages as PDF,
// Excel or CSV (format=, CSV without one), one row per school, weekday and
// half hour, all schools together first. With school=ID it holds that
// school alone; a school of another Träger and an unknown ID answer 404
// traeger.school_not_found.
func (rs *Resource) arrivalPickupTimesExport(w http.ResponseWriter, r *http.Request) {
	format, schoolID, ok := readExportOptions(w, r)
	if !ok {
		return
	}
	times, ok := rs.readArrivalPickupTimes(w, r)
	if !ok {
		return
	}
	writeArrivalPickupExport(w, r, rs.lists, format, schoolID, times)
}

func writeArrivalPickupExport(w http.ResponseWriter, r *http.Request, render common.ListRenderer, format string, schoolID int64, times traegerview.ArrivalPickupTimes) {
	if schoolID == 0 {
		common.WriteList(w, r, render, format, arrivalPickupTable(times, ""))
		return
	}
	school, found := findSchool(times.Schools, schoolID, func(s traegerview.SchoolArrivalPickupTimes) traegerview.School { return s.School })
	if !found {
		renderSchoolNotFound(w, r)
		return
	}
	times.Schools = []traegerview.SchoolArrivalPickupTimes{school}
	common.WriteList(w, r, render, format, arrivalPickupTable(times, school.Name))
}

func (rs *Resource) readArrivalPickupTimes(w http.ResponseWriter, r *http.Request) (traegerview.ArrivalPickupTimes, bool) {
	principal, err := common.CurrentPrincipal(r.Context())
	if err != nil || principal.OrganizationID() <= 0 {
		common.RenderError(w, r, common.ErrorUnauthorized(common.ErrUnauthorized))
		return traegerview.ArrivalPickupTimes{}, false
	}
	query := r.URL.Query()
	from, fromErr := calendar.ParseDate(query.Get("from"))
	to, toErr := calendar.ParseDate(query.Get("to"))
	if fromErr != nil || toErr != nil {
		common.RenderError(w, r, common.ErrorInvalidRequest(fmt.Errorf("%w: from and to must be dates (YYYY-MM-DD)", traegerview.ErrInvalidArrivalPickupPeriod)))
		return traegerview.ArrivalPickupTimes{}, false
	}
	times, err := rs.reports.ArrivalPickupTimes(r.Context(), principal.OrganizationID(), from, to)
	switch {
	case errors.Is(err, traegerview.ErrInvalidArrivalPickupPeriod):
		common.RenderError(w, r, common.ErrorInvalidRequest(err))
	case errors.Is(err, traegerview.ErrTraegerUnavailable):
		common.RenderError(w, r, common.ErrorUnauthorized(common.ErrUnauthorized))
	case err != nil:
		common.RenderError(w, r, common.ErrorInternalServer(err))
	default:
		return times, true
	}
	return traegerview.ArrivalPickupTimes{}, false
}

// arrivalPickupWeekdays names the ISO weekdays.
var arrivalPickupWeekdays = [...]string{"", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"}

// arrivalPickupAllSchools names the rows of all schools together.
const arrivalPickupAllSchools = "Alle Schulen"

// arrivalPickupTable is one row per school, weekday and half hour: the
// period, the school and its town, the weekday, the half hour, the average
// arrivals and pickups of a day and the days they come from. A spreadsheet
// filters it by school and weekday. The rows of all schools together come
// first, unless the export holds one school.
func arrivalPickupTable(times traegerview.ArrivalPickupTimes, schoolName string) common.ListTable {
	from, to := times.From.Format("02.01.2006"), times.To.Format("02.01.2006")
	var rows [][]string
	appendHeatmap := func(school, city string, heatmap traegerview.ArrivalPickupHeatmap) {
		for _, weekday := range heatmap.Weekdays {
			for _, slot := range weekday.Slots {
				rows = append(rows, []string{from, to, school, city, arrivalPickupWeekdays[weekday.Weekday],
					slotLabel(slot.StartMinute, times.SlotMinutes), decimal(slot.Arrivals), decimal(slot.Pickups), strconv.Itoa(weekday.Days)})
			}
		}
	}
	if schoolName == "" {
		appendHeatmap(arrivalPickupAllSchools, "", times.All)
	}
	for _, school := range times.Schools {
		appendHeatmap(school.Name, school.City, school.ArrivalPickupHeatmap)
	}
	return common.ListTable{
		Title: "Ankunft und Abholung", Subtitle: from + " bis " + to,
		Filters: []string{common.ListSchoolLabel(schoolName), common.ListPeriodLabel(from, to)},
		Columns: []common.ListColumn{
			{ID: "from", Label: "Von", SpreadsheetOnly: true}, {ID: "to", Label: "Bis", SpreadsheetOnly: true},
			{ID: "school", Label: "Schule"}, {ID: "city", Label: "Ort"}, {ID: "weekday", Label: "Wochentag"},
			{ID: "slot", Label: "Uhrzeit"}, {ID: "arrivals", Label: "Ankunft je Tag"}, {ID: "pickups", Label: "Abholung je Tag"},
			{ID: "days", Label: "Tage"},
		},
		Rows: rows, Filename: fmt.Sprintf("ankunft-und-abholung-%s-bis-%s", times.From, times.To),
	}
}

// slotLabel is „07:30–08:00“.
func slotLabel(start, length int) string {
	clock := func(minute int) string { return fmt.Sprintf("%02d:%02d", minute/60%24, minute%60) }
	return clock(start) + "–" + clock(start+length)
}

// decimal is a German decimal with one place: „2,5“.
func decimal(value float64) string {
	return strings.Replace(strconv.FormatFloat(value, 'f', 1, 64), ".", ",", 1)
}
