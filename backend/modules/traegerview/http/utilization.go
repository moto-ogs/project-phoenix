package traegerviewhttp

import (
	"errors"
	"fmt"
	"net/http"
	"strconv"

	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/modules/traegerview"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// utilization answers GET /traeger/schools/utilization?from=&to=: the
// utilization of every school of the Träger of the session, of its care
// offerings and of its rooms per weekday of the window (#4713). The answer
// holds counts and the names of offerings and rooms, no child, so the read is
// not written to the access log (ADR 0084 section 7, ADR 0241).
func (rs *Resource) utilization(w http.ResponseWriter, r *http.Request) {
	utilization, ok := rs.readUtilization(w, r)
	if !ok {
		return
	}
	common.Respond(w, r, http.StatusOK, utilization, "Utilization retrieved successfully")
}

// utilizationExport answers GET /traeger/schools/utilization/export: the same
// figures as PDF, Excel or CSV (format=, CSV without one), one row per day
// and school, offering or room, optionally of one school (school=ID). A
// school of another Träger and an unknown ID answer 404
// traeger.school_not_found, like the children of a school.
func (rs *Resource) utilizationExport(w http.ResponseWriter, r *http.Request) {
	format, schoolID, ok := readExportOptions(w, r)
	if !ok {
		return
	}
	utilization, ok := rs.readUtilization(w, r)
	if !ok {
		return
	}
	schoolName := ""
	if schoolID > 0 {
		school, found := findSchool(utilization.Schools, schoolID, func(s traegerview.SchoolUtilization) traegerview.School { return s.School })
		if !found {
			renderSchoolNotFound(w, r)
			return
		}
		utilization.Schools, schoolName = []traegerview.SchoolUtilization{school}, school.Name
	}
	writeList(w, r, rs.lists, format, utilizationTable(utilization, schoolName))
}

// utilizationChildren answers GET /traeger/schools/{id}/utilization/children:
// the children of one school of the Träger by name over the window, the rows
// of the school's Statistik report. The report writes the read to the
// school's access log with the account of the session. A school of another
// Träger and an unknown ID both answer 404 traeger.school_not_found.
func (rs *Resource) utilizationChildren(w http.ResponseWriter, r *http.Request) {
	principal, err := common.CurrentPrincipal(r.Context())
	if err != nil || principal.OrganizationID() <= 0 || principal.AccountID() <= 0 {
		common.RenderError(w, r, common.ErrorUnauthorized(common.ErrUnauthorized))
		return
	}
	schoolID, err := common.ParseIDParam(r, "id")
	if err != nil {
		common.RenderError(w, r, common.ErrorInvalidRequest(err))
		return
	}
	from, to, err := utilizationWindow(r)
	if err != nil {
		common.RenderError(w, r, common.ErrorInvalidRequest(err))
		return
	}
	viewer := traegerview.Viewer{OrganizationID: principal.OrganizationID(), AccountID: principal.AccountID()}
	children, err := rs.overview.UtilizationChildren(r.Context(), viewer, schoolID, from, to)
	switch {
	case errors.Is(err, traegerview.ErrSchoolOutsideTraeger):
		common.RenderError(w, r, common.ErrorNotFoundWithCode(err, common.CodeTraegerSchoolNotFound))
	case errors.Is(err, traegerview.ErrInvalidUtilizationWindow):
		common.RenderError(w, r, common.ErrorInvalidRequest(err))
	case errors.Is(err, traegerview.ErrTraegerUnavailable):
		common.RenderError(w, r, common.ErrorUnauthorized(common.ErrUnauthorized))
	case err != nil:
		common.RenderError(w, r, common.ErrorInternalServer(err))
	default:
		common.Respond(w, r, http.StatusOK, children, "Utilization children retrieved successfully")
	}
}

func (rs *Resource) readUtilization(w http.ResponseWriter, r *http.Request) (traegerview.Utilization, bool) {
	principal, err := common.CurrentPrincipal(r.Context())
	if err != nil || principal.OrganizationID() <= 0 {
		common.RenderError(w, r, common.ErrorUnauthorized(common.ErrUnauthorized))
		return traegerview.Utilization{}, false
	}
	from, to, err := utilizationWindow(r)
	if err != nil {
		common.RenderError(w, r, common.ErrorInvalidRequest(err))
		return traegerview.Utilization{}, false
	}
	utilization, err := rs.overview.Utilization(r.Context(), principal.OrganizationID(), from, to)
	switch {
	case errors.Is(err, traegerview.ErrInvalidUtilizationWindow):
		common.RenderError(w, r, common.ErrorInvalidRequest(err))
		return traegerview.Utilization{}, false
	case errors.Is(err, traegerview.ErrTraegerUnavailable):
		common.RenderError(w, r, common.ErrorUnauthorized(common.ErrUnauthorized))
		return traegerview.Utilization{}, false
	case err != nil:
		common.RenderError(w, r, common.ErrorInternalServer(err))
		return traegerview.Utilization{}, false
	}
	return utilization, true
}

// utilizationWindow reads the required days from and to (YYYY-MM-DD).
func utilizationWindow(r *http.Request) (calendar.Date, calendar.Date, error) {
	query := r.URL.Query()
	from, err := calendar.ParseDate(query.Get("from"))
	if err != nil {
		return "", "", fmt.Errorf("%w: from must be a date (YYYY-MM-DD)", traegerview.ErrInvalidUtilizationWindow)
	}
	to, err := calendar.ParseDate(query.Get("to"))
	if err != nil {
		return "", "", fmt.Errorf("%w: to must be a date (YYYY-MM-DD)", traegerview.ErrInvalidUtilizationWindow)
	}
	return from, to, nil
}

// The kinds of a row of the utilization export.
const (
	utilizationRowSchool   = "Schule"
	utilizationRowOffering = "Betreuungsangebot"
	utilizationRowRoom     = "Raum"
)

// utilizationColumns are the columns of the utilization export.
var utilizationColumns = []ListColumn{
	{ID: "day", Label: "Datum"}, {ID: "school", Label: "Schule"}, {ID: "city", Label: "Ort"}, {ID: "kind", Label: "Art"},
	{ID: "name", Label: "Name"}, {ID: "places", Label: "Plätze", Numeric: true}, {ID: "booked", Label: "Kinder gebucht", Numeric: true},
	{ID: "booked_places", Label: "Plätze belegt", Numeric: true}, {ID: "present", Label: "Kinder anwesend", Numeric: true},
	{ID: "room_children", Label: "Kinder im Raum", Numeric: true}, {ID: "room_peak", Label: "Höchstens gleichzeitig", Numeric: true},
}

// utilizationTable is one row per day and school, offering or room. A
// figure that does not apply to the kind, or that is missing on a day,
// stays empty, so a spreadsheet never reads a gap as 0.
func utilizationTable(utilization traegerview.Utilization, schoolName string) ListTable {
	var rows [][]string
	for i, day := range utilization.Days {
		date := day.Format("02.01.2006")
		for _, school := range utilization.Schools {
			row := func(kind, name string, figures ...string) []string {
				return append([]string{date, school.Name, school.City, kind, name}, figures...)
			}
			rows = append(rows, row(utilizationRowSchool, "", placesCount(school.Places), strconv.Itoa(school.Booked[i]),
				strconv.Itoa(school.BookedPlaces[i]), optionalCount(school.Present[i]), "", ""))
			for _, offering := range school.Offerings {
				rows = append(rows, row(utilizationRowOffering, offering.Name, optionalCount(offering.Capacity), strconv.Itoa(offering.Booked[i]), "", "", "", ""))
			}
			for _, room := range school.Rooms {
				rows = append(rows, row(utilizationRowRoom, room.Name, optionalCount(room.Capacity), "", "", "", optionalCount(room.Children[i]), optionalCount(room.Peak[i])))
			}
		}
	}
	from, to := utilization.From.Format("02.01.2006"), utilization.To.Format("02.01.2006")
	return ListTable{
		Title: "Auslastung", Subtitle: from + " bis " + to,
		Filters: []string{schoolFilterLabel(schoolName), periodLabel(from, to)},
		Columns: utilizationColumns, Rows: rows,
		Filename: fmt.Sprintf("auslastung-%s-bis-%s", utilization.From, utilization.To),
	}
}

func optionalCount(value *int) string {
	if value == nil {
		return ""
	}
	return strconv.Itoa(*value)
}

// placesCount leaves the places of a school without a limited offering
// empty instead of 0.
func placesCount(places int) string {
	if places == 0 {
		return ""
	}
	return strconv.Itoa(places)
}
