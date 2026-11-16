package parentbillinghttp

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/moto-ogs/project-phoenix/api/common"
	capability "github.com/moto-ogs/project-phoenix/modules/parentbilling"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/tenant"
)

// The lists of the families name parents, children, numbers and accounts
// (#4718). Each export reads through the list's capability, which records
// the read in the trail of every family number, run or mandate it shows.

var (
	documentKindLabels = map[string]string{
		capability.DocumentInvoice: "Rechnung", capability.DocumentCancellation: "Storno", capability.DocumentCredit: "Gutschrift",
	}
	invoiceStateLabels = map[string]string{
		capability.InvoiceOpen: "Forderung offen", capability.InvoicePartlyCredited: "Teilgutschrift",
		capability.InvoiceCredited: "Gutgeschrieben", capability.InvoiceCancelled: "Storniert", capability.InvoiceNothingDue: "Nichts zu zahlen",
	}
	familyChildrenStates = map[string]string{
		capability.FamilyChildrenMissing: "Keine Angabe", capability.FamilyChildrenStated: "Neu von Eltern",
		capability.FamilyChildrenChanged: "Eltern melden Änderung", capability.FamilyChildrenConfirmed: "Bestätigt",
		capability.FamilyChildrenExpiring: "Läuft bald ab", capability.FamilyChildrenExpired: "Abgelaufen",
		capability.FamilyChildrenUpcoming: "Gilt später",
	}
	mandateKindLabels = map[string]string{capability.MandateRecurring: "Dauermandat", capability.MandateOneOff: "Einzelmandat"}
)

// paymentText is who pays: the family, a cost bearer or nobody.
func paymentText(payment capability.BillingPayment) string {
	switch payment.Kind {
	case capability.PaymentCostBearer:
		if payment.CostBearerName != "" {
			return "Kostenübernahme: " + payment.CostBearerName
		}
		return "Kostenübernahme"
	case capability.PaymentExempt:
		return "Beitragsfrei"
	default:
		return "Familie zahlt selbst"
	}
}

// exportList answers GET /traeger/billing-families/export: every family
// with its numbers, who pays and its sums.
func (rs *BillingFamilyResource) exportList(w http.ResponseWriter, r *http.Request) {
	reviewer, ok := reviewerOf(w, r)
	if !ok {
		return
	}
	format, ok := common.ListFormatOf(w, r)
	if !ok {
		return
	}
	families, err := rs.families.ListBillingFamilies(r.Context(), reviewer)
	if err != nil {
		tenant.MarkRollback(r.Context())
		renderFamilyError(w, r, err)
		return
	}
	table := newListTable("Familien der Abrechnung", "familien", true,
		column("last_name", "Nachname"), column("first_name", "Vorname"), column("email", "E-Mail"),
		column("debtor", "Debitorennummer"), column("payment", "Zahlung"), column("method", "Zahlungsart"),
		column("issued", "Ausgestellt"), column("cancelled", "Storniert"), column("credited", "Gutgeschrieben"),
		column("open", "Offene Forderung"))
	for _, family := range families {
		number := family.FamilyDebtorNumber
		if number == "" {
			number = strings.Join(family.DebtorNumbers, ", ")
		}
		payments := make([]string, len(family.Payments))
		for i, payment := range family.Payments {
			payments[i] = paymentText(payment)
		}
		methods := make([]string, 0, len(family.PaymentMethods))
		for _, method := range family.PaymentMethods {
			methods = append(methods, paymentMethodLabels[method])
		}
		table.Rows = append(table.Rows, []string{
			family.RecipientLastName, family.RecipientFirstName, family.RecipientEmail, number,
			strings.Join(payments, ", "), strings.Join(methods, ", "), euroText(family.IssuedCents),
			euroText(family.CancelledCents), euroText(family.CreditedCents), euroText(family.OpenCents),
		})
	}
	common.WriteList(w, r, rs.lists, format, table)
}

// exportDocuments answers GET /traeger/billing-families/{id}/export: every
// document of one family, the newest first.
func (rs *BillingFamilyResource) exportDocuments(w http.ResponseWriter, r *http.Request) {
	reviewer, ok := reviewerOf(w, r)
	if !ok {
		return
	}
	format, ok := common.ListFormatOf(w, r)
	if !ok {
		return
	}
	familyID, err := common.ParseIDParam(r, "id")
	if err != nil {
		common.RenderError(w, r, common.ErrorInvalidRequest(err))
		return
	}
	family, err := rs.families.BillingFamily(r.Context(), reviewer, familyID)
	if err != nil {
		tenant.MarkRollback(r.Context())
		renderFamilyError(w, r, err)
		return
	}
	table := newListTable("Dokumente der Familie", "familie-dokumente", true,
		column("issued", "Datum"), column("kind", "Dokument"), column("number", "Nummer"), column("status", "Stand"),
		column("reference", "Bezug"), column("payment", "Zahlung"), column("period", "Zeitraum"),
		column("days", "Betreuung"), column("children", "Kinder"), column("amount", "Betrag"), column("open", "Offene Forderung"))
	table.Subtitle = personName(family.RecipientFirstName, family.RecipientLastName)
	for _, document := range family.Documents {
		table.Rows = append(table.Rows, familyDocumentRow(document))
	}
	common.WriteList(w, r, rs.lists, format, table)
}

func familyDocumentRow(document capability.BillingFamilyDocument) []string {
	reference, open := "", "–"
	if document.ReferenceNumber != "" {
		reference = "Zu " + document.ReferenceNumber
		if document.Reason != "" {
			reference += " · " + document.Reason
		}
	}
	var payment []string
	if document.Kind == capability.DocumentInvoice {
		open = euroText(document.OpenCents)
		if label := paymentMethodLabels[document.PaymentMethod]; label != "" {
			payment = append(payment, label)
		}
		if document.DueOn != nil {
			payment = append(payment, "fällig am "+dateText(*document.DueOn))
		}
		if document.Payment != nil && document.Payment.Kind != capability.PaymentFamily {
			payment = append(payment, paymentText(*document.Payment))
		}
	}
	return []string{
		dateText(document.IssuedOn), documentKindLabels[document.Kind], document.Number, invoiceStateLabels[document.Status],
		reference, strings.Join(payment, " · "), document.PeriodName, periodText(document.ServiceFrom, document.ServiceUntil),
		strings.Join(document.ChildNames, ", "), euroText(document.TotalCents), open,
	}
}

// exportList answers GET /traeger/family-children/export: every family with
// its children under contract, the number the parents stated and the
// number the Abrechnung confirmed.
func (rs *FamilyChildrenResource) exportList(w http.ResponseWriter, r *http.Request) {
	reviewer, ok := reviewerOf(w, r)
	if !ok {
		return
	}
	format, ok := common.ListFormatOf(w, r)
	if !ok {
		return
	}
	set, err := rs.office.FamilyChildren(r.Context(), reviewer)
	if err != nil {
		tenant.MarkRollback(r.Context())
		renderFamilyChildrenError(w, r, err)
		return
	}
	table := newListTable("Kinderzahl der Familien", "kinderzahl", true,
		column("last_name", "Nachname"), column("first_name", "Vorname"), column("email", "E-Mail"),
		column("children", "Kinder mit Vertrag"), column("stated", "Angabe der Eltern"),
		column("confirmed", "Bestätigte Kinderzahl"), column("valid", "Gültig"), column("status", "Stand"))
	for _, family := range set.Families {
		children := make([]string, len(family.Children))
		for i, child := range family.Children {
			children[i] = personName(child.ChildFirstName, child.ChildLastName) + " (" + child.SchoolName + ")"
		}
		stated, confirmed, valid := "–", "–", "–"
		if count := family.Count; count != nil {
			stated, confirmed = optionalCount(count.StatedChildren), optionalCount(count.ConfirmedChildren)
			valid = validityText(count.ValidFrom, count.ValidUntil)
		}
		table.Rows = append(table.Rows, []string{
			family.RecipientLastName, family.RecipientFirstName, family.RecipientEmail, strings.Join(children, ", "),
			stated, confirmed, valid, familyChildrenStates[family.Status],
		})
	}
	common.WriteList(w, r, rs.lists, format, table)
}

func optionalCount(count *int) string {
	if count == nil {
		return "–"
	}
	return strconv.Itoa(*count)
}

// validityText is „ab 01.09.2026“ or a period; „–“ without a start.
func validityText(from, until *calendar.Date) string {
	switch {
	case from == nil:
		return "–"
	case until == nil:
		return "ab " + dateText(*from)
	default:
		return periodText(*from, *until)
	}
}

// exportMandates answers GET /traeger/sepa-mandates/export: every mandate,
// newest first, with the masked IBAN the list shows.
func (rs *SEPAMandateResource) exportMandates(w http.ResponseWriter, r *http.Request) {
	reviewer, ok := reviewerOf(w, r)
	if !ok {
		return
	}
	format, ok := common.ListFormatOf(w, r)
	if !ok {
		return
	}
	mandates, err := rs.mandates.ListSEPAMandates(r.Context(), reviewer, 0)
	if err != nil {
		tenant.MarkRollback(r.Context())
		renderMandateError(w, r, err, common.CodeParentBillingSepaMandateInvalid)
		return
	}
	table := newListTable("SEPA-Mandate", "sepa-mandate", true,
		column("family", "Familie"), column("reference", "Mandatsreferenz"), column("kind", "Art"),
		column("iban", "Konto"), column("holder", "Kontoinhaber"), column("signed", "Unterschrieben"),
		column("last", "Zuletzt abgebucht"), column("expires", "Verfällt ohne Abbuchung am"), column("status", "Stand"))
	today := rs.today()
	for _, mandate := range mandates {
		table.Rows = append(table.Rows, []string{
			personName(mandate.PartyFirstName, mandate.PartyLastName), mandate.Reference, mandateKindLabels[mandate.Kind],
			mandate.IBANMasked, mandate.AccountHolder, dateText(mandate.SignedOn), optionalDate(mandate.LastCollectedOn),
			dateText(mandate.ExpiresOn), mandateStateText(mandate, today),
		})
	}
	common.WriteList(w, r, rs.lists, format, table)
}

// mandateStateText is the state of a mandate on today's Berlin calendar day.
func mandateStateText(mandate capability.SEPAMandate, today calendar.Date) string {
	switch {
	case mandate.RevokedOn != nil:
		return "Widerrufen seit " + dateText(*mandate.RevokedOn)
	case !mandate.CreditorCurrent:
		return "Neues Mandat nötig"
	case !mandate.ExpiresOn.IsZero() && !mandate.ExpiresOn.After(today):
		return "Verfallen"
	default:
		return "In Kraft"
	}
}
