package parentbillinghttp

import (
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/moto-ogs/project-phoenix/api/common"
	capability "github.com/moto-ogs/project-phoenix/modules/parentbilling"
)

// The lists of the runs name no person: a run is a period, its counts and
// its sums (#4718).

var monthRuleLabels = map[string]string{
	capability.MonthRuleVersionOnFirst: "Voller Monat nach dem Vertrag am 1.",
	capability.MonthRuleProRata:        "Anteilig nach Kalendertagen",
}

// exportList answers GET /traeger/billing-runs/export: the holiday runs as
// the list shows them, of one holiday period with holiday_period_id.
func (rs *BillingRunResource) exportList(w http.ResponseWriter, r *http.Request) {
	organizationID, ok := traegerOf(w, r)
	if !ok {
		return
	}
	format, ok := common.ListFormatOf(w, r)
	if !ok {
		return
	}
	periodID := int64(0)
	if raw := r.URL.Query().Get("holiday_period_id"); raw != "" {
		id, err := strconv.ParseInt(raw, 10, 64)
		if err != nil || id <= 0 {
			common.RenderError(w, r, common.ErrorInvalidRequest(errors.New("holiday_period_id must be a positive ID")))
			return
		}
		periodID = id
	}
	runs, err := rs.runs.ListBillingRuns(r.Context(), organizationID)
	if err != nil {
		renderBillingError(w, r, err)
		return
	}
	common.WriteList(w, r, rs.lists, format, billingRunTable(runs, periodID))
}

// billingRunTable is one row per holiday run, of the period when one is
// chosen.
func billingRunTable(runs []capability.BillingRun, periodID int64) common.ListTable {
	table := newListTable("Abrechnungsläufe Ferienbetreuung", "abrechnungslaeufe", false,
		column("period", "Ferienzeitraum"), column("days", "Betreuung"), column("status", "Status"),
		column("invoices", "Rechnungen"), column("total", "Summe"), column("issued", "Ausgestellt am"))
	periodName := ""
	for _, run := range runs {
		if periodID > 0 && run.HolidayPeriodID != periodID {
			continue
		}
		periodName = run.PeriodName
		table.Rows = append(table.Rows, []string{
			run.PeriodName, periodText(run.ServiceFrom, run.ServiceUntil), runStatusLabels[run.Status],
			countText(run.DocumentCount, "Rechnung", "Rechnungen"), optionalEuro(run.TotalCents), optionalDate(run.IssuedOn),
		})
	}
	if periodID > 0 {
		if periodName == "" {
			periodName = "ausgewählter Ferienzeitraum"
		}
		table.Filters = append(table.Filters, "Ferienzeitraum: "+periodName)
	}
	return table
}

// exportList answers GET /traeger/care-billing-runs/export: the monthly
// runs, the latest month first, with the names of their schools.
func (rs *CareBillingResource) exportList(w http.ResponseWriter, r *http.Request) {
	organizationID, ok := traegerOf(w, r)
	if !ok {
		return
	}
	format, ok := common.ListFormatOf(w, r)
	if !ok {
		return
	}
	list, err := rs.billing.ListCareRuns(r.Context(), organizationID)
	if err != nil {
		renderCareError(w, r, err)
		return
	}
	schools, err := rs.billing.CareRunSchools(r.Context(), organizationID, list.SuggestedMonth)
	if err != nil {
		renderCareError(w, r, err)
		return
	}
	common.WriteList(w, r, rs.lists, format, careRunTable(list.Runs, schools))
}

func careRunTable(runs []capability.CareRun, schools []capability.CareRunSchool) common.ListTable {
	table := newListTable("Monatsbeiträge", "monatsbeitraege", false,
		column("month", "Monat"), column("status", "Status"), column("schools", "Schulen"),
		column("invoices", "Rechnungen"), column("total", "Summe"), column("issued", "Ausgestellt am"),
		column("rule", "Bei Vertragsänderung im Monat"))
	names := make(map[int64]string, len(schools))
	for _, school := range schools {
		names[school.ID] = school.Name
	}
	for _, run := range runs {
		rule := monthRuleLabels[run.MonthRule]
		if rule == "" {
			rule = "–"
		}
		table.Rows = append(table.Rows, []string{
			run.BillingMonth.Format("01/2006"), runStatusLabels[run.Status], runSchoolNames(run.SchoolIDs, names),
			countText(run.DocumentCount, "Rechnung", "Rechnungen"), optionalEuro(run.TotalCents), optionalDate(run.IssuedOn), rule,
		})
	}
	return table
}

// runSchoolNames names the schools of a run; all of several schools are
// „Alle n Schulen“ like on the page.
func runSchoolNames(schoolIDs []int64, names map[int64]string) string {
	if len(schoolIDs) == 0 {
		return "–"
	}
	if len(names) > 1 && len(schoolIDs) == len(names) {
		return "Alle " + strconv.Itoa(len(names)) + " Schulen"
	}
	shown := make([]string, len(schoolIDs))
	for i, id := range schoolIDs {
		shown[i] = names[id]
		if shown[i] == "" {
			shown[i] = "Schule"
		}
	}
	return strings.Join(shown, ", ")
}

// exportList answers GET /traeger/care-notice-runs/export: the runs of the
// Jahresbescheide.
func (rs *CareNoticeResource) exportList(w http.ResponseWriter, r *http.Request) {
	organizationID, ok := traegerOf(w, r)
	if !ok {
		return
	}
	format, ok := common.ListFormatOf(w, r)
	if !ok {
		return
	}
	list, err := rs.notices.ListCareNoticeRuns(r.Context(), organizationID)
	if err != nil {
		renderNoticeError(w, r, err)
		return
	}
	table := newListTable("Jahresbescheide", "jahresbescheide", false,
		column("period", "Zeitraum"), column("status", "Status"), column("schools", "Schulen"),
		column("notices", "Bescheide"), column("total", "Summe"), column("issued", "Abgeschlossen am"))
	for _, run := range list.Runs {
		status := noticeRunStatusLabels[run.Status]
		if run.Status == capability.RunReleased && run.NoticeCount != nil && *run.NoticeCount == 0 {
			status = "Abgeschlossen"
		}
		notices := "–"
		if run.NoticeCount != nil {
			notices = countText(run.NoticeCount, "Bescheid", "Bescheide")
		}
		table.Rows = append(table.Rows, []string{
			periodText(run.PeriodFrom, run.PeriodUntil), status, schoolCountText(run.SchoolIDs),
			notices, optionalEuro(run.TotalCents), optionalDate(run.IssuedOn),
		})
	}
	common.WriteList(w, r, rs.lists, format, table)
}
