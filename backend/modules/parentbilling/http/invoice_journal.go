package parentbillinghttp

import (
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/render"
	validation "github.com/go-ozzo/ozzo-validation"

	"github.com/moto-ogs/project-phoenix/api/common"
	capability "github.com/moto-ogs/project-phoenix/modules/parentbilling"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/tenant"
)

// InvoiceJournalResource serves the Rechnungsausgangsbuch of a Träger at
// /traeger/invoice-journal (#4819): every issued document in one list, with
// its filters and its export. Every route sits behind the Träger session,
// needs the Träger right "Abrechnung" and runs in the Träger transaction of
// the session's Träger, which comes from the session, never from the
// request.
type InvoiceJournalResource struct {
	journal        capability.InvoiceJournal
	requireBilling common.Middleware
	lists          common.ListRenderer
}

// NewInvoiceJournalResource builds the resource. requireBilling admits only
// a session with the Träger right "Abrechnung".
func NewInvoiceJournalResource(journal capability.InvoiceJournal, requireBilling common.Middleware, lists common.ListRenderer) *InvoiceJournalResource {
	if journal == nil || requireBilling == nil || lists == nil {
		panic("parent billing http: the journal, the right check and the list export are required")
	}
	return &InvoiceJournalResource{journal: journal, requireBilling: requireBilling, lists: lists}
}

// Router returns the routes mounted at /traeger/invoice-journal.
func (rs *InvoiceJournalResource) Router(protectedTraegerRoutes func(chi.Router, func(chi.Router, common.Middleware))) chi.Router {
	r := chi.NewRouter()
	r.Use(render.SetContentType(render.ContentTypeJSON))
	protectedTraegerRoutes(r, func(r chi.Router, withTx common.Middleware) {
		billing := r.With(rs.requireBilling, withTx)
		billing.Get("/", rs.list)
		billing.Get("/export", rs.export)
	})
	return r
}

// JournalIssuerTraeger is the value of the issuer filter that names the
// Träger, whose key is empty.
const JournalIssuerTraeger = "traeger"

// journalFilter is the query of the journal: the period, the issuer, the
// number range by service and year, the document type, the run and a search
// text.
var journalFilter = []common.QueryParam{
	{Name: "from", Kind: common.QueryDate}, {Name: "to", Kind: common.QueryDate},
	{Name: "issuer", Kind: common.QueryString, TextReason: "the creditor identifier of the issuer, or traeger for the Träger"},
	{Name: "service", Kind: common.QueryString, Values: []string{capability.ServiceHoliday, capability.ServiceCare}},
	{Name: "year", Kind: common.QueryInt},
	{Name: "document_type", Kind: common.QueryString, Values: capability.JournalDocumentTypes},
	{Name: "run_kind", Kind: common.QueryString, Values: capability.JournalRunKinds},
	{Name: "run_id", Kind: common.QueryID},
	{Name: "search", Kind: common.QueryString},
}

// InvoiceJournalRouteContracts registers the Rechnungsausgangsbuch (#4819),
// relative to /traeger/invoice-journal. The export answers a file (#2352).
func InvoiceJournalRouteContracts() []common.RouteContract {
	page := append([]common.QueryParam{{Name: "page", Kind: common.QueryInt}}, journalFilter...)
	export := append([]common.QueryParam{common.ListFormatQuery}, journalFilter...)
	return []common.RouteContract{
		{Method: "GET", Pattern: "/", Portals: traegerPortal, Query: page, Response: capability.InvoiceJournalPage{},
			Enums: []common.EnumContract{
				{Name: "JournalDocumentType", Fields: []string{"JournalDocument.document_type"}, Values: capability.JournalDocumentTypes},
				{Name: "JournalRunKind", Fields: []string{"JournalRun.kind"}, Values: capability.JournalRunKinds},
				{Name: "JournalReferenceKind", Fields: []string{"JournalReference.kind"}, Values: capability.JournalReferenceKinds},
			}},
		{Method: "GET", Pattern: "/export", Portals: traegerPortal, Query: export, File: true},
	}
}

// list answers GET /traeger/invoice-journal: one page of the filter, the
// newest document first.
func (rs *InvoiceJournalResource) list(w http.ResponseWriter, r *http.Request) {
	reviewer, ok := reviewerOf(w, r)
	if !ok {
		return
	}
	filter, err := journalFilterOf(r)
	if err != nil {
		common.RenderError(w, r, common.ErrorInvalidRequest(err))
		return
	}
	filter.Page = 1
	if raw := r.URL.Query().Get("page"); raw != "" {
		if filter.Page, err = strconv.Atoi(raw); err != nil || filter.Page < 1 {
			common.RenderError(w, r, common.ErrorInvalidRequest(fmt.Errorf("page must be a number from 1: %q", raw)))
			return
		}
	}
	page, err := rs.journal.InvoiceJournal(r.Context(), reviewer, filter)
	if err != nil {
		tenant.MarkRollback(r.Context())
		renderJournalError(w, r, err)
		return
	}
	common.Respond(w, r, http.StatusOK, page, "Invoice journal retrieved successfully")
}

// export answers GET /traeger/invoice-journal/export: every document of the
// filter by number range and number, as PDF, Excel or CSV.
func (rs *InvoiceJournalResource) export(w http.ResponseWriter, r *http.Request) {
	reviewer, ok := reviewerOf(w, r)
	if !ok {
		return
	}
	format, ok := common.ListFormatOf(w, r)
	if !ok {
		return
	}
	filter, err := journalFilterOf(r)
	if err != nil {
		common.RenderError(w, r, common.ErrorInvalidRequest(err))
		return
	}
	page, err := rs.journal.InvoiceJournal(r.Context(), reviewer, filter)
	if err != nil {
		tenant.MarkRollback(r.Context())
		renderJournalError(w, r, err)
		return
	}
	common.WriteList(w, r, rs.lists, format, journalTable(filter, page))
}

func renderJournalError(w http.ResponseWriter, r *http.Request, err error) {
	var fields validation.Errors
	if errors.As(err, &fields) {
		common.RenderError(w, r, common.ErrorInvalidRequest(err))
		return
	}
	renderBillingError(w, r, err)
}

// journalFilterOf reads the filter of the journal; the owner checks its
// values.
func journalFilterOf(r *http.Request) (capability.InvoiceJournalFilter, error) {
	query := r.URL.Query()
	filter := capability.InvoiceJournalFilter{
		Service: query.Get("service"), DocumentType: query.Get("document_type"), RunKind: query.Get("run_kind"), Search: query.Get("search"),
		AnyIssuer: true, AnyYear: true,
	}
	var err error
	if filter.From, err = journalDay(query.Get("from"), "from"); err != nil {
		return capability.InvoiceJournalFilter{}, err
	}
	if filter.Until, err = journalDay(query.Get("to"), "to"); err != nil {
		return capability.InvoiceJournalFilter{}, err
	}
	if issuer := query.Get("issuer"); issuer != "" {
		filter.AnyIssuer = false
		if issuer != JournalIssuerTraeger {
			filter.Issuer = issuer
		}
	}
	if raw := query.Get("year"); raw != "" {
		if filter.Year, err = strconv.Atoi(raw); err != nil || filter.Year < 0 {
			return capability.InvoiceJournalFilter{}, fmt.Errorf("year must be a year or 0: %q", raw)
		}
		filter.AnyYear = false
	}
	if raw := query.Get("run_id"); raw != "" {
		if filter.RunID, err = strconv.ParseInt(raw, 10, 64); err != nil || filter.RunID <= 0 {
			return capability.InvoiceJournalFilter{}, fmt.Errorf("run_id must be a positive ID: %q", raw)
		}
	}
	return filter, nil
}

func journalDay(raw, name string) (*calendar.Date, error) {
	if raw == "" {
		return nil, nil
	}
	day, err := calendar.ParseDate(raw)
	if err != nil {
		return nil, fmt.Errorf("%s must be a date (YYYY-MM-DD)", name)
	}
	return &day, nil
}

// Labels of the journal as the page names them.
var (
	journalDocumentTypeLabels = map[string]string{
		capability.JournalInvoice: "Rechnung", capability.JournalFeeNotice: "Gebührenbescheid",
		capability.JournalConfirmation: "Bestätigung und Rechnung", capability.JournalCancellation: "Storno",
		capability.JournalCredit: "Gutschrift",
	}
	journalServiceLabels = map[string]string{
		capability.ServiceHoliday: "Ferienbetreuung", capability.ServiceCare: "Monatsbeiträge",
	}
	journalReferenceLabels = map[string]string{
		capability.JournalReferenceCancels: "Storno zu", capability.JournalReferenceCredits: "Gutschrift zu",
		capability.JournalReferenceReplaces: "Ersetzt", capability.JournalReferenceAmends: "Ändert",
	}
)

// journalIssuerText names an issuer: the Träger, or the body by its name.
func journalIssuerText(issuer capability.BillingIssuer) string {
	if issuer.IsTraeger() {
		return "Träger"
	}
	return issuer.Name
}

// journalRangeText names a number range: its service and, when its counter
// starts anew every year, its year.
func journalRangeText(service string, year int) string {
	if year == 0 {
		return journalServiceLabels[service]
	}
	return journalServiceLabels[service] + " " + strconv.Itoa(year)
}

// journalRunText names a run as the lists of the runs do.
func journalRunText(run capability.JournalRun) string {
	switch run.Kind {
	case capability.JournalRunCare:
		if run.Month != nil {
			return "Monatsbeiträge " + run.Month.Format("01/2006")
		}
		return "Monatsbeiträge"
	case capability.JournalRunCareNotice:
		return "Jahresbescheide " + strconv.Itoa(run.Year)
	default:
		return run.Name
	}
}

// journalGapText names a gap of a number range in one sentence: the missing
// numbers as a document would carry them, else their running numbers.
func journalGapText(gap capability.JournalNumberGap) string {
	first, last := gap.FirstMissingNumber, gap.LastMissingNumber
	one, many := "die Nummer", "die Nummern"
	if first == "" {
		first, last = strconv.FormatInt(gap.FirstMissing, 10), strconv.FormatInt(gap.FirstMissing+gap.MissingCount-1, 10)
		one, many = "die laufende Nummer", "die laufenden Nummern"
	}
	missing := "fehlen " + many + " " + first + " bis " + last
	switch gap.MissingCount {
	case 1:
		missing = "fehlt " + one + " " + first
	case 2:
		missing = "fehlen " + many + " " + first + " und " + last
	}
	name := journalRangeText(gap.Service, gap.Year)
	if !gap.Issuer.IsTraeger() {
		name += " (" + gap.Issuer.Name + ")"
	}
	return "Lücke im Nummernkreis " + name + ": Es " + missing + "."
}

// journalFilterTexts is the head of the file: what the filter kept, and
// every gap of the number ranges in view.
func journalFilterTexts(filter capability.InvoiceJournalFilter, page capability.InvoiceJournalPage) []string {
	texts := []string{common.ListSchoolLabel("")}
	switch {
	case filter.From != nil && filter.Until != nil:
		texts = append(texts, "Zeitraum: "+periodText(*filter.From, *filter.Until))
	case filter.From != nil:
		texts = append(texts, "Zeitraum: ab "+dateText(*filter.From))
	case filter.Until != nil:
		texts = append(texts, "Zeitraum: bis "+dateText(*filter.Until))
	}
	if !filter.AnyIssuer {
		texts = append(texts, "Rechnungssteller: "+journalFilterIssuer(filter, page))
	}
	if filter.Service != "" {
		year := 0
		if !filter.AnyYear {
			year = filter.Year
		}
		texts = append(texts, "Nummernkreis: "+journalRangeText(filter.Service, year))
	}
	if filter.DocumentType != "" {
		texts = append(texts, "Dokumentart: "+journalDocumentTypeLabels[filter.DocumentType])
	}
	for _, run := range page.Runs {
		if filter.RunID != 0 && run.Kind == filter.RunKind && run.ID.Int64() == filter.RunID {
			texts = append(texts, "Lauf: "+journalRunText(run))
		}
	}
	if filter.Search != "" {
		texts = append(texts, "Suche: "+strings.TrimSpace(filter.Search))
	}
	for _, gap := range page.Gaps {
		texts = append(texts, journalGapText(gap))
	}
	return texts
}

// journalFilterIssuer names the issuer of the filter by a number range that
// carries it.
func journalFilterIssuer(filter capability.InvoiceJournalFilter, page capability.InvoiceJournalPage) string {
	for _, numberRange := range page.NumberRanges {
		if numberRange.Issuer.Key == filter.Issuer {
			return journalIssuerText(numberRange.Issuer)
		}
	}
	if filter.Issuer == "" {
		return "Träger"
	}
	return filter.Issuer
}

// journalTable is the file of the journal: one row per document, by number
// range and number, and the sums at its end.
func journalTable(filter capability.InvoiceJournalFilter, page capability.InvoiceJournalPage) common.ListTable {
	table := newListTable("Rechnungsausgangsbuch", "rechnungsausgangsbuch", true,
		column("number", "Nummer"), column("issued", "Ausgestellt am"), column("type", "Dokumentart"), column("recipient", "Empfänger"),
		column("issuer", "Rechnungssteller"), column("range", "Nummernkreis"), column("run", "Lauf"), column("reference", "Bezug"),
		euroColumn("net", "Netto"), euroColumn("tax", "Steuer"), euroColumn("gross", "Brutto"))
	table.Filters = journalFilterTexts(filter, page)
	for _, document := range page.Documents {
		reference := ""
		if document.Reference != nil {
			reference = journalReferenceLabels[document.Reference.Kind] + " " + document.Reference.Number
		}
		table.Rows = append(table.Rows, []string{
			document.Number, dateText(document.IssuedOn), journalDocumentTypeLabels[document.DocumentType],
			personName(document.RecipientFirstName, document.RecipientLastName), journalIssuerText(document.Issuer),
			journalRangeText(document.Service, document.NumberYear), journalRunText(document.Run), reference,
			decimalEuro(document.NetCents), decimalEuro(document.TaxCents), decimalEuro(document.GrossCents),
		})
	}
	if len(page.Documents) > 0 {
		table.Rows = append(table.Rows, []string{"Summe", "", "", "", "", "", "", "",
			decimalEuro(page.Totals.NetCents), decimalEuro(page.Totals.TaxCents), decimalEuro(page.Totals.GrossCents)})
	}
	return table
}
