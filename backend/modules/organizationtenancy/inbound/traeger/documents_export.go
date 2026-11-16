package traeger

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/modules/organizationtenancy"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// export answers GET /traeger/documents/export: the documents of the list
// as PDF, Excel or CSV (format=, CSV without one), newest first, with whom
// each is released for (#4718). Titles, file names and the number of reads
// name no person, so the export is not written to a log, like the list.
func (rs *DocumentsResource) export(w http.ResponseWriter, r *http.Request) {
	format, ok := common.ListFormatOf(w, r)
	if !ok {
		return
	}
	organizationID, _, ok := session(w, r)
	if !ok {
		return
	}
	documents, err := rs.documents.ListDocuments(r.Context(), organizationID)
	if err != nil {
		renderDocumentError(w, r, err)
		return
	}
	schools, err := rs.schools.TraegerSchools(r.Context(), organizationID)
	if err != nil {
		common.RenderError(w, r, common.ErrorInternalServer(err))
		return
	}
	names := make(map[int64]string, len(schools))
	for _, school := range schools {
		names[school.ID] = school.Name
	}
	rows := make([][]string, 0, len(documents))
	for _, document := range documents {
		audiences := make([]string, 0, len(document.Releases))
		for _, release := range document.Releases {
			audiences = append(audiences, releaseAudience(release, names))
		}
		released := strings.Join(audiences, "; ")
		if released == "" {
			released = "Noch niemand"
		}
		rows = append(rows, []string{
			document.Title, document.FileName, released, strconv.Itoa(document.Reads),
			document.CreatedAt.In(calendar.Berlin).Format("02.01.2006"),
		})
	}
	common.WriteList(w, r, rs.lists, format, common.ListTable{
		Title: "Dokumente", Filters: []string{common.ListSchoolLabel("")},
		Columns: []common.ListColumn{
			{ID: "title", Label: "Dokument"}, {ID: "file", Label: "Datei"}, {ID: "releases", Label: "Freigegeben für"},
			{ID: "reads", Label: "Geöffnet"}, {ID: "created", Label: "Hochgeladen"},
		},
		Rows: rows, Filename: "dokumente",
	})
}

// releaseAudience names whom a release reaches, as the list does.
func releaseAudience(release organizationtenancy.TraegerDocumentRelease, names map[int64]string) string {
	school := ""
	if release.SchoolID != nil {
		school = names[*release.SchoolID]
		if school == "" {
			school = "eine Schule"
		}
	}
	switch {
	case release.Audience == organizationtenancy.TraegerDocumentForSchools && school == "":
		return "OGS-Leitung aller Schulen"
	case release.Audience == organizationtenancy.TraegerDocumentForSchools:
		return "OGS-Leitung: " + school
	case release.GroupID != nil && school == "":
		return "Eltern der Gruppe „" + release.GroupName + "“"
	case release.GroupID != nil:
		return "Eltern der Gruppe „" + release.GroupName + "“ (" + school + ")"
	case school == "":
		return "Eltern an allen Schulen"
	default:
		return "Eltern: " + school
	}
}
