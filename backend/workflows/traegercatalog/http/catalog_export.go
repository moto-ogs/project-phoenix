package traegercataloghttp

import (
	"net/http"
	"strconv"

	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/modules/enrollment"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// exportPhases answers GET /traeger/catalog/phases/export: the Träger
// phases of the list as PDF, Excel or CSV (format=, CSV without one), one
// row per phase (#4718). A phase names no person, so the export is not
// written to a log, like the list.
func (rs *Resource) exportPhases(w http.ResponseWriter, r *http.Request) {
	format, ok := common.ListFormatOf(w, r)
	if !ok {
		return
	}
	actor, ok := actorOf(w, r)
	if !ok {
		return
	}
	phases, err := rs.phases.ListTraegerPhases(r.Context(), actor.OrganizationID)
	if err != nil {
		renderCatalogError(w, r, err)
		return
	}
	rows := make([][]string, 0, len(phases))
	for _, phase := range phases {
		rows = append(rows, []string{
			phase.Draft.Name, phaseDay(phase.Draft.ServiceStartDate), phaseDay(phase.Draft.ServiceEndDate),
			phaseSchools(phase), strconv.Itoa(phaseOpenSchools(phase)), phaseState(phase),
		})
	}
	common.WriteList(w, r, rs.lists, format, common.ListTable{
		Title: "Anmeldephasen", Filters: []string{common.ListSchoolLabel("")},
		Columns: []common.ListColumn{
			{ID: "name", Label: "Anmeldephase"}, {ID: "service_start", Label: "Leistungszeitraum von"},
			{ID: "service_end", Label: "Leistungszeitraum bis"}, {ID: "schools", Label: "Schulen"},
			{ID: "open", Label: "Nicht übernommen"}, {ID: "state", Label: "Stand"},
		},
		Rows: rows, Filename: "anmeldephasen",
	})
}

// phaseDay is „01.08.2027“; a day it cannot read stays as stored.
func phaseDay(day enrollment.Date) string {
	parsed, err := calendar.ParseDate(string(day))
	if err != nil {
		return string(day)
	}
	return parsed.Format("02.01.2006")
}

// phaseSchools is „Alle Schulen“ or the number of chosen schools.
func phaseSchools(phase enrollment.TraegerPhase) string {
	if phase.AllSchools {
		return "Alle Schulen"
	}
	count := 0
	for _, school := range phase.Schools {
		if school.Selected {
			count++
		}
	}
	if count == 1 {
		return "1 Schule"
	}
	return strconv.Itoa(count) + " Schulen"
}

// phaseOpenSchools counts the target schools that refused or missed the
// last rollout of a released phase.
func phaseOpenSchools(phase enrollment.TraegerPhase) int {
	if phase.WithdrawnAt != nil || phase.ReleasedVersion == nil {
		return 0
	}
	open := 0
	for _, school := range phase.Schools {
		if (phase.AllSchools || school.Selected) && (school.Outcome == enrollment.TraegerOutcomeRejected || school.Outcome == enrollment.TraegerOutcomeStale) {
			open++
		}
	}
	return open
}

// phaseState is the state of a phase as the list names it.
func phaseState(phase enrollment.TraegerPhase) string {
	switch {
	case phase.WithdrawnAt != nil:
		return "Zurückgezogen"
	case phase.ReleasedVersion == nil:
		return "Noch nicht übertragen"
	default:
		return "Übertragen"
	}
}
