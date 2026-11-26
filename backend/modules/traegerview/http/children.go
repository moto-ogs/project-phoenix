package traegerviewhttp

import (
	"errors"
	"fmt"
	"net/http"
	"strconv"

	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/modules/traegerview"
)

// children answers GET /traeger/schools/children: one page of the children
// the schools of the Träger of the session count today, by name (#8137, ADR
// 0327), of one school (school_id=) or all, narrowed by a part of the name
// (search=), continuing at cursor=. The projection writes the read to the
// access log of each school with a row on the page. A school of another
// Träger and an unknown ID both answer 404 traeger.school_not_found.
func (rs *Resource) children(w http.ResponseWriter, r *http.Request) {
	viewer, ok := traegerViewer(w, r)
	if !ok {
		return
	}
	filter, err := childrenFilter(r)
	if err != nil {
		common.RenderError(w, r, common.ErrorInvalidRequest(err))
		return
	}
	filter.Cursor = r.URL.Query().Get("cursor")
	children, err := rs.reports.Children(r.Context(), viewer, filter)
	if err != nil {
		renderChildrenError(w, r, err)
		return
	}
	common.Respond(w, r, http.StatusOK, children, "Children retrieved successfully")
}

// childrenExport answers GET /traeger/schools/children/export: every child
// of the filter as PDF, Excel or CSV (format=, CSV without one), one row per
// child (#4718). The projection writes the export to the access log of each
// school with a row.
func (rs *Resource) childrenExport(w http.ResponseWriter, r *http.Request) {
	format, ok := common.ListFormatOf(w, r)
	if !ok {
		return
	}
	viewer, ok := traegerViewer(w, r)
	if !ok {
		return
	}
	filter, err := childrenFilter(r)
	if err != nil {
		common.RenderError(w, r, common.ErrorInvalidRequest(err))
		return
	}
	export, err := rs.reports.ChildrenExport(r.Context(), viewer, filter)
	if err != nil {
		renderChildrenError(w, r, err)
		return
	}
	common.WriteList(w, r, rs.lists, format, childrenTable(export))
}

// childrenFilter reads the optional school_id and search.
func childrenFilter(r *http.Request) (traegerview.ChildrenFilter, error) {
	query := r.URL.Query()
	filter := traegerview.ChildrenFilter{Search: query.Get("search")}
	if raw := query.Get("school_id"); raw != "" {
		school, err := strconv.ParseInt(raw, 10, 64)
		if err != nil || school <= 0 {
			return filter, fmt.Errorf("%w: school_id must be a positive ID", traegerview.ErrInvalidChildrenFilter)
		}
		filter.SchoolID = school
	}
	return filter, nil
}

func renderChildrenError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, traegerview.ErrSchoolOutsideTraeger):
		renderSchoolNotFound(w, r)
	case errors.Is(err, traegerview.ErrInvalidChildrenFilter):
		common.RenderError(w, r, common.ErrorInvalidRequest(err))
	case errors.Is(err, traegerview.ErrTraegerUnavailable):
		// The moto team deactivated the Träger: its session has ended.
		common.RenderError(w, r, common.ErrorUnauthorized(common.ErrUnauthorized))
	default:
		common.RenderError(w, r, common.ErrorInternalServer(err))
	}
}

// childrenTable is the export: one row per child in the order of the list.
// The head names the school and the search of the filter.
func childrenTable(export traegerview.ChildrenExport) common.ListTable {
	rows := make([][]string, 0, len(export.Children))
	for _, child := range export.Children {
		rows = append(rows, []string{child.LastName, child.FirstName, child.SchoolName, child.SchoolClass, child.GroupName})
	}
	filters := []string{common.ListSchoolLabel(export.SchoolName)}
	if export.Search != "" {
		filters = append(filters, "Suche: "+export.Search)
	}
	return common.ListTable{
		Title: "Kinder", Filters: filters,
		Columns: []common.ListColumn{
			{ID: "last_name", Label: "Nachname"}, {ID: "first_name", Label: "Vorname"}, {ID: "school", Label: "Schule"},
			{ID: "school_class", Label: "Klasse"}, {ID: "group", Label: "Gruppe"},
		},
		Rows: rows, Footer: common.ListPersonalDataFooter, Filename: "kinder",
	}
}
