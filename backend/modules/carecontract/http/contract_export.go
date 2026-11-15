package carecontracthttp

import (
	"net/http"
	"strings"
	"time"

	"github.com/moto-ogs/project-phoenix/api/common"
	"github.com/moto-ogs/project-phoenix/modules/carecontract"
)

// contractStatusLabels are the statuses as the list names them.
var contractStatusLabels = map[string]string{
	carecontract.StatusDraft: "Entwurf", carecontract.StatusSent: "Versendet", carecontract.StatusActive: "Aktiv",
	carecontract.StatusTerminated: "Gekündigt", carecontract.StatusWithdrawn: "Widerrufen", carecontract.StatusEnded: "Beendet",
}

// exportContracts answers GET /traeger/contracts/export: every contract of
// the list's filter (status, school_id, search) as PDF, Excel or CSV
// (format=, CSV without one), newest first (#4718). The read is written to
// the access log of each school.
func (rs *Resource) exportContracts(w http.ResponseWriter, r *http.Request) {
	reviewer, ok := reviewerOf(w, r)
	if !ok {
		return
	}
	format, err := listFormat(r)
	if err != nil {
		common.RenderError(w, r, common.ErrorInvalidRequest(err))
		return
	}
	schoolID, err := optionalID(r, "school_id")
	if err != nil {
		common.RenderError(w, r, common.ErrorInvalidRequest(err))
		return
	}
	query := r.URL.Query()
	filter := carecontract.ContractFilter{Status: query.Get("status"), SchoolID: schoolID, Search: strings.TrimSpace(query.Get("search")), Export: true}
	list, err := rs.contracts.ListContracts(r.Context(), reviewer, filter)
	if err != nil {
		renderError(w, r, err)
		return
	}
	writeList(w, r, rs.lists, format, contractTable(filter, list.Contracts))
}

var berlin = func() *time.Location {
	location, err := time.LoadLocation("Europe/Berlin")
	if err != nil {
		return time.FixedZone("CET", 60*60)
	}
	return location
}()

// contractTable is one row per contract. The school of a filter for one
// school comes from its contracts; without a contract the file names none.
func contractTable(filter carecontract.ContractFilter, contracts []carecontract.ContractSummary) ListTable {
	rows := make([][]string, 0, len(contracts))
	schoolName := ""
	for _, contract := range contracts {
		if contract.SchoolID == filter.SchoolID {
			schoolName = contract.SchoolName
		}
		rows = append(rows, []string{
			contract.ChildLastName, contract.ChildFirstName, contract.SchoolName, contract.ModulesText,
			contract.PartyName, contract.PartyEmail, contract.EffectiveFrom.Format("02.01.2006"),
			contractStatusLabels[contract.Status], contractStatusDay(contract),
		})
	}
	filters := []string{schoolFilterLabel(filter.SchoolID, schoolName)}
	if label, ok := contractStatusLabels[filter.Status]; ok {
		filters = append(filters, "Status: "+label)
	}
	if filter.Search != "" {
		filters = append(filters, "Suche: "+filter.Search)
	}
	return ListTable{
		Title: "Betreuungsverträge", Filters: filters,
		Columns: []ListColumn{
			{ID: "last_name", Label: "Nachname"}, {ID: "first_name", Label: "Vorname"}, {ID: "school", Label: "Betreuungsort"},
			{ID: "modules", Label: "Module"}, {ID: "party", Label: "Eltern"}, {ID: "email", Label: "E-Mail"},
			{ID: "start", Label: "Beginn"}, {ID: "status", Label: "Status"}, {ID: "status_day", Label: "Seit"},
		},
		Rows: rows, Footer: personalDataFooter, Filename: "betreuungsvertraege",
	}
}

// contractStatusDay is the day the status names: the end of a terminated
// contract, the conclusion, or the dispatch.
func contractStatusDay(contract carecontract.ContractSummary) string {
	switch {
	case contract.Status == carecontract.StatusTerminated && contract.EndsOn != nil:
		return "zum " + contract.EndsOn.Format("02.01.2006")
	case contract.Status == carecontract.StatusWithdrawn:
		return ""
	case contract.Concluded != nil:
		return contract.Concluded.At.In(berlin).Format("02.01.2006")
	case contract.SentAt != nil:
		return contract.SentAt.In(berlin).Format("02.01.2006")
	default:
		return ""
	}
}
