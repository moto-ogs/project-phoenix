package traegerviewhttp

import (
	"bytes"
	"encoding/csv"
	"errors"
	"fmt"
	"net/http"
	"strconv"

	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/modules/traegerview"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/textnorm"
)

// dailyAttendance answers GET /traeger/schools/daily-attendance: the daily
// attendance report of the Träger's schools in Mecklenburg-Vorpommern
// between the days from and to (#4717). It names no child; the projection
// still records the read in the access log of each school with children.
func (rs *Resource) dailyAttendance(w http.ResponseWriter, r *http.Request) {
	viewer, from, to, ok := dailyAttendanceRequest(w, r)
	if !ok {
		return
	}
	report, err := rs.reports.DailyAttendance(r.Context(), viewer, from, to)
	if !renderDailyAttendanceError(w, r, err) {
		common.Respond(w, r, http.StatusOK, report, "Daily attendance retrieved successfully")
	}
}

// dailyAttendanceExport answers GET /traeger/schools/daily-attendance/export:
// the report as CSV, one row per child and day without name or ID. The
// projection writes the export to the access log of every school with rows
// before the file leaves.
func (rs *Resource) dailyAttendanceExport(w http.ResponseWriter, r *http.Request) {
	viewer, from, to, ok := dailyAttendanceRequest(w, r)
	if !ok {
		return
	}
	export, err := rs.reports.DailyAttendanceExport(r.Context(), viewer, from, to)
	if renderDailyAttendanceError(w, r, err) {
		return
	}
	data, err := dailyAttendanceCSV(export)
	if err != nil {
		common.RenderError(w, r, common.ErrorInternalServer(err))
		return
	}
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", textnorm.ContentDisposition("attachment", fmt.Sprintf("tagesmeldung-mv-%s-bis-%s.csv", export.From, export.To)))
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(data)
}

// dailyAttendanceRequest reads the session's Träger and account and the
// period of a request.
func dailyAttendanceRequest(w http.ResponseWriter, r *http.Request) (traegerview.Viewer, calendar.Date, calendar.Date, bool) {
	principal, err := common.CurrentPrincipal(r.Context())
	if err != nil || principal.OrganizationID() <= 0 || principal.AccountID() <= 0 {
		common.RenderError(w, r, common.ErrorUnauthorized(common.ErrUnauthorized))
		return traegerview.Viewer{}, "", "", false
	}
	viewer := traegerview.Viewer{OrganizationID: principal.OrganizationID(), AccountID: principal.AccountID()}
	query := r.URL.Query()
	from, fromErr := calendar.ParseDate(query.Get("from"))
	to, toErr := calendar.ParseDate(query.Get("to"))
	if fromErr != nil || toErr != nil {
		common.RenderError(w, r, common.ErrorInvalidRequest(fmt.Errorf("%w: from and to must be dates (YYYY-MM-DD)", traegerview.ErrInvalidDailyAttendancePeriod)))
		return traegerview.Viewer{}, "", "", false
	}
	return viewer, from, to, true
}

// renderDailyAttendanceError renders a failed read and reports whether it
// did.
func renderDailyAttendanceError(w http.ResponseWriter, r *http.Request, err error) bool {
	switch {
	case err == nil:
		return false
	case errors.Is(err, traegerview.ErrInvalidDailyAttendancePeriod):
		common.RenderError(w, r, common.ErrorInvalidRequest(err))
	case errors.Is(err, traegerview.ErrTraegerUnavailable):
		common.RenderError(w, r, common.ErrorUnauthorized(common.ErrUnauthorized))
	default:
		common.RenderError(w, r, common.ErrorInternalServer(err))
	}
	return true
}

// dailyAttendanceStatus names a record's status in plain German.
var dailyAttendanceStatus = map[string]string{
	traegerview.AttendancePresent:   "anwesend",
	traegerview.AttendanceSick:      "krank",
	traegerview.AttendanceExcused:   "entschuldigt",
	traegerview.AttendanceClassTrip: "Klassenfahrt",
}

// dailyAttendanceCSV writes the general mapping until the state publishes
// its format (KiföAVO M-V): one row per child and day with the school, its
// town, the day, a running number of the day at that school, the status,
// arrival, pickup (Berlin wall clock) and the stay in minutes. The running
// number counts rows, it identifies no child across days.
func dailyAttendanceCSV(export traegerview.DailyAttendanceExport) ([]byte, error) {
	schools := make(map[int64]traegerview.School, len(export.Schools))
	for _, school := range export.Schools {
		schools[school.ID] = school
	}
	var buf bytes.Buffer
	buf.WriteString("\xEF\xBB\xBF")
	writer := csv.NewWriter(&buf)
	writer.Comma = ';'
	rows := [][]string{{"Einrichtung", "Ort", "Datum", "Lfd. Nr.", "Status", "Ankunft", "Abholung", "Anwesenheit in Minuten"}}
	number, last := 0, struct {
		school int64
		date   calendar.Date
	}{}
	for _, record := range export.Records {
		if record.SchoolID != last.school || record.Date != last.date {
			number, last.school, last.date = 0, record.SchoolID, record.Date
		}
		number++
		school := schools[record.SchoolID]
		row := []string{csvSafe(school.Name), csvSafe(school.City), record.Date.Format("02.01.2006"), strconv.Itoa(number), dailyAttendanceStatus[record.Status], "", "", ""}
		if record.ArrivedAt != nil {
			row[5] = record.ArrivedAt.In(calendar.Berlin).Format("15:04")
		}
		if record.LeftAt != nil {
			row[6] = record.LeftAt.In(calendar.Berlin).Format("15:04")
		}
		if record.Minutes != nil {
			row[7] = strconv.Itoa(*record.Minutes)
		}
		rows = append(rows, row)
	}
	if err := writer.WriteAll(rows); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}
