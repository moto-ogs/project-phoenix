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
// figures as CSV, one row per day and school, offering or room, optionally of
// one school (school=ID). A school of another Träger and an unknown ID answer
// 404 traeger.school_not_found, like the children of a school.
func (rs *Resource) utilizationExport(w http.ResponseWriter, r *http.Request) {
	utilization, ok := rs.readUtilization(w, r)
	if !ok {
		return
	}
	if raw := r.URL.Query().Get("school"); raw != "" {
		schoolID, err := strconv.ParseInt(raw, 10, 64)
		if err != nil || schoolID <= 0 {
			common.RenderError(w, r, common.ErrorInvalidRequest(errors.New("school must be a positive ID")))
			return
		}
		if utilization.Schools = schoolsWithID(utilization.Schools, schoolID); utilization.Schools == nil {
			common.RenderError(w, r, common.ErrorNotFoundWithCode(traegerview.ErrSchoolOutsideTraeger, common.CodeTraegerSchoolNotFound))
			return
		}
	}
	data, err := utilizationCSV(utilization)
	if err != nil {
		common.RenderError(w, r, common.ErrorInternalServer(err))
		return
	}
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", textnorm.ContentDisposition("attachment",
		fmt.Sprintf("auslastung-%s-bis-%s.csv", utilization.From, utilization.To)))
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(data)
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

func schoolsWithID(schools []traegerview.SchoolUtilization, schoolID int64) []traegerview.SchoolUtilization {
	for _, school := range schools {
		if school.ID == schoolID {
			return []traegerview.SchoolUtilization{school}
		}
	}
	return nil
}

// The kinds of a row of the utilization export.
const (
	utilizationRowSchool   = "Schule"
	utilizationRowOffering = "Betreuungsangebot"
	utilizationRowRoom     = "Raum"
)

var utilizationCSVHeader = []string{
	"Datum", "Schule", "Ort", "Art", "Name", "Plätze", "Kinder gebucht", "Plätze belegt", "Kinder anwesend", "Kinder im Raum", "Höchstens gleichzeitig",
}

// utilizationCSV writes one row per day and school, offering or room. A
// figure that does not apply to the kind, or that is missing on a day,
// stays empty, so a spreadsheet never reads a gap as 0.
func utilizationCSV(utilization traegerview.Utilization) ([]byte, error) {
	var buf bytes.Buffer
	buf.WriteString("\xEF\xBB\xBF")
	writer := csv.NewWriter(&buf)
	writer.Comma = ';'
	rows := [][]string{utilizationCSVHeader}
	for i, day := range utilization.Days {
		date := day.Format("02.01.2006")
		for _, school := range utilization.Schools {
			row := func(kind, name string, figures ...string) []string {
				return append([]string{date, csvSafe(school.Name), csvSafe(school.City), kind, csvSafe(name)}, figures...)
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
	if err := writer.WriteAll(rows); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
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
