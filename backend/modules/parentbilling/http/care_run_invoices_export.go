package parentbillinghttp

import (
	"net/http"

	"github.com/moto-ogs/project-phoenix/api/common"
	capability "github.com/moto-ogs/project-phoenix/modules/parentbilling"
	"github.com/moto-ogs/project-phoenix/tenant"
)

// careServiceLabels name what an invoice bills, as the run page does.
var careServiceLabels = map[string]string{
	capability.ServiceCare: "Betreuung",
	capability.ServiceMeal: "Mensa",
}

// exportInvoices answers GET /traeger/care-billing-runs/{id}/invoices/export:
// the invoices of a monthly run as PDF, Excel or CSV (format=, CSV without
// one; #4718), the list a released run shows. It reads the run like its page,
// so the download leaves the same read entry in the run's trail.
func (rs *CareBillingResource) exportInvoices(w http.ResponseWriter, r *http.Request) {
	format, ok := common.ListFormatOf(w, r)
	if !ok {
		return
	}
	reviewer, runID, ok := runKey(w, r)
	if !ok {
		return
	}
	detail, err := rs.billing.CareRun(r.Context(), reviewer, runID)
	if err != nil {
		tenant.MarkRollback(r.Context())
		renderCareError(w, r, err)
		return
	}
	month := detail.BillingMonth.Format("2006-01")
	table := newListTable("Rechnungen des Monatslaufs", "rechnungen-monatsbeitrag-"+month, true,
		column("number", "Rechnung Nr."), column("issued", "Ausgestellt am"), column("school", "Schule"),
		column("last_name", "Nachname"), column("first_name", "Vorname"), column("service", "Leistung"),
		column("recipient", "Empfänger"), column("debtor", "Debitorennummer"), column("total", "Summe"))
	table.Subtitle = "Monat " + detail.BillingMonth.Format("01.2006")
	for _, invoice := range detail.Invoices {
		table.Rows = append(table.Rows, []string{
			invoice.Number, optionalDate(invoice.IssuedOn), invoice.SchoolName, invoice.ChildLastName, invoice.ChildFirstName,
			careServiceLabels[invoice.Service], invoice.Recipient.FirstName + " " + invoice.Recipient.LastName,
			invoice.DebtorNumber, euroText(invoice.TotalCents),
		})
	}
	common.WriteList(w, r, rs.lists, format, table)
}
