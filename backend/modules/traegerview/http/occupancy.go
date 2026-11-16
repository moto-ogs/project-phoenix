package traegerviewhttp

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/modules/traegerview"
)

// occupancy answers GET /traeger/schools/occupancy: the children of every
// school of the Träger of the session by OGS group and care form, today
// (#4676). The answer holds counts and the names of groups and offers, no
// child, so the read is not written to the access log (ADR 0084 section 7).
func (rs *Resource) occupancy(w http.ResponseWriter, r *http.Request) {
	occupancy, ok := rs.readOccupancy(w, r)
	if !ok {
		return
	}
	common.Respond(w, r, http.StatusOK, occupancy, "Occupancy retrieved successfully")
}

// occupancyExport answers GET /traeger/schools/occupancy/export: the same
// figures as PDF, Excel or CSV (format=, CSV without one), one row per
// school and figure, for every school or one (school=ID). A school of
// another Träger and an unknown ID answer 404 traeger.school_not_found.
func (rs *Resource) occupancyExport(w http.ResponseWriter, r *http.Request) {
	format, schoolID, ok := readExportOptions(w, r)
	if !ok {
		return
	}
	occupancy, ok := rs.readOccupancy(w, r)
	if !ok {
		return
	}
	schoolName := ""
	if schoolID > 0 {
		school, found := findSchool(occupancy.Schools, schoolID, func(s traegerview.SchoolOccupancy) traegerview.School { return s.School })
		if !found {
			renderSchoolNotFound(w, r)
			return
		}
		occupancy.Schools, schoolName = []traegerview.SchoolOccupancy{school}, school.Name
	}
	writeList(w, r, rs.lists, format, occupancyTable(occupancy, schoolName))
}

func (rs *Resource) readOccupancy(w http.ResponseWriter, r *http.Request) (traegerview.Occupancy, bool) {
	principal, err := common.CurrentPrincipal(r.Context())
	if err != nil || principal.OrganizationID() <= 0 {
		common.RenderError(w, r, common.ErrorUnauthorized(common.ErrUnauthorized))
		return traegerview.Occupancy{}, false
	}
	occupancy, err := rs.overview.Occupancy(r.Context(), principal.OrganizationID())
	switch {
	case errors.Is(err, traegerview.ErrTraegerUnavailable):
		common.RenderError(w, r, common.ErrorUnauthorized(common.ErrUnauthorized))
		return traegerview.Occupancy{}, false
	case err != nil:
		common.RenderError(w, r, common.ErrorInternalServer(err))
		return traegerview.Occupancy{}, false
	}
	return occupancy, true
}

// The kinds of a row of the occupancy export.
const (
	occupancyRowTotal           = "Alle Kinder"
	occupancyRowGroup           = "Gruppe"
	occupancyRowWithoutGroup    = "Ohne Gruppe"
	occupancyRowCareForm        = "Betreuungsform"
	occupancyRowWithoutCareForm = "Ohne Betreuungsform"
)

// occupancyTable is one row per school and figure: the school, its town,
// the kind of the row, the name of the group or offer, the children and the
// places of the offer. A spreadsheet filters and sums it by kind.
func occupancyTable(occupancy traegerview.Occupancy, schoolName string) ListTable {
	day := occupancy.Day.Format("02.01.2006")
	var rows [][]string
	for _, school := range occupancy.Schools {
		row := func(kind, name string, children int, capacity *int) []string {
			places := ""
			if capacity != nil {
				places = strconv.Itoa(*capacity)
			}
			return []string{day, school.Name, school.City, kind, name, strconv.Itoa(children), places}
		}
		rows = append(rows, row(occupancyRowTotal, "", school.Children, nil))
		for _, group := range school.Groups {
			rows = append(rows, row(occupancyRowGroup, group.Name, group.Children, nil))
		}
		rows = append(rows, row(occupancyRowWithoutGroup, "", school.WithoutGroup, nil))
		for _, form := range school.CareForms {
			rows = append(rows, row(occupancyRowCareForm, form.Name, form.Children, form.Capacity))
		}
		rows = append(rows, row(occupancyRowWithoutCareForm, "", school.WithoutCareForm, nil))
	}
	return ListTable{
		Title: "Belegung", Subtitle: "Stand " + day,
		Filters: []string{schoolFilterLabel(schoolName)},
		Columns: []ListColumn{
			{ID: "day", Label: "Datum", SpreadsheetOnly: true}, {ID: "school", Label: "Schule"}, {ID: "city", Label: "Ort"},
			{ID: "kind", Label: "Art"}, {ID: "name", Label: "Name"}, {ID: "children", Label: "Kinder", Numeric: true}, {ID: "places", Label: "Plätze", Numeric: true},
		},
		Rows: rows, Filename: "belegung-" + occupancy.Day.String(),
	}
}

// findSchool returns the entry of the school with the ID.
func findSchool[T any](entries []T, schoolID int64, school func(T) traegerview.School) (T, bool) {
	for _, entry := range entries {
		if school(entry).ID == schoolID {
			return entry, true
		}
	}
	var none T
	return none, false
}
