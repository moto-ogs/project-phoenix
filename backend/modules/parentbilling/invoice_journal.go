package parentbilling

import (
	"context"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

// The Rechnungsausgangsbuch of a Träger (#4819): every issued document of
// the Elternabrechnung in one list, across all runs, issuers and number
// ranges. The Träger-Büro and an audit read it by number: a number range
// counts without a gap, and a number that is missing is named.
//
// A document is in the journal once it has its number. A calculated run has
// no document yet, so a draft never appears. The journal changes nothing: an
// issued document never changes (ADR 0119), so the list is a read of what
// the releases wrote.
//
// A number range is the counter the releases draw from: one per issuer,
// service and year (ADR 0119, #8040 ADR 0322). The holiday care counts on its
// own; the monthly invoices, their cancellations and the Jahresbescheide
// share the range of the care. A pattern without a year counts through the
// years and has the year 0.

// Document types of the journal. An invoice of a run carries the kind the
// release froze on it (#4688); a cancellation and a credit are documents of
// their own (#4690); a Jahresbescheid is a fee notice (#6219).
const (
	JournalInvoice      = DocumentKindInvoice
	JournalFeeNotice    = DocumentKindFeeNotice
	JournalConfirmation = DocumentKindConfirmation
	JournalCancellation = DocumentCancellation
	JournalCredit       = DocumentCredit
)

// JournalDocumentTypes are the types in the order the filter shows them.
var JournalDocumentTypes = []string{JournalInvoice, JournalFeeNotice, JournalConfirmation, JournalCancellation, JournalCredit}

// Runs a document of the journal belongs to. The three kinds of run keep
// their own IDs, so a run is named by its kind and its ID.
const (
	// JournalRunHoliday is a run of the holiday care (#4668).
	JournalRunHoliday = "holiday"
	// JournalRunCare is a monthly run of the care (#4685).
	JournalRunCare = "care"
	// JournalRunCareNotice is a run of Jahresbescheide (#6219).
	JournalRunCareNotice = "care_notice"
)

// JournalRunKinds are the kinds of run of the journal.
var JournalRunKinds = []string{JournalRunHoliday, JournalRunCare, JournalRunCareNotice}

// How a document refers to another one.
const (
	// JournalReferenceCancels is a cancellation of the invoice it names.
	JournalReferenceCancels = "cancels"
	// JournalReferenceCredits is a credit for the invoice it names.
	JournalReferenceCredits = "credits"
	// JournalReferenceReplaces is an invoice issued again for the cancelled
	// invoice it names.
	JournalReferenceReplaces = "replaces"
	// JournalReferenceAmends is a Jahresbescheid that changes the notice it
	// names.
	JournalReferenceAmends = "amends"
)

// JournalReferenceKinds are the ways a document refers to another one.
var JournalReferenceKinds = []string{JournalReferenceCancels, JournalReferenceCredits, JournalReferenceReplaces, JournalReferenceAmends}

// Columns a page of the journal is ordered by (#8138).
const (
	// JournalSortNumber orders by number range and running number.
	JournalSortNumber = "number"
	// JournalSortIssued orders by the issue day.
	JournalSortIssued = "issued"
	// JournalSortRecipient orders by the recipient's last and first name.
	JournalSortRecipient = "recipient"
	// JournalSortGross orders by the gross amount.
	JournalSortGross = "gross"
	// JournalSortOpen orders by what an invoice still asks for.
	JournalSortOpen = "open"
)

// JournalSorts are the columns a page of the journal is ordered by.
var JournalSorts = []string{JournalSortNumber, JournalSortIssued, JournalSortRecipient, JournalSortGross, JournalSortOpen}

// JournalInvoiceStates are the states of an invoice the journal filters by,
// the states the families show (#4691).
var JournalInvoiceStates = []string{InvoiceOpen, InvoicePartlyCredited, InvoiceCredited, InvoiceCancelled, InvoiceNothingDue}

// InvoiceJournalPageSize is the number of documents one page of the journal
// carries.
const InvoiceJournalPageSize = 100

// MaxInvoiceJournalSearchLength bounds the search text of the journal.
const MaxInvoiceJournalSearchLength = 100

// InvoiceNumberServices are the services whose counters number documents.
var InvoiceNumberServices = []string{ServiceHoliday, ServiceCare}

// InvoiceJournalFilter narrows the journal. The zero value shows every
// document of the Träger. Page counts from 1; zero reads every document that
// passes, which is what an export asks for.
type InvoiceJournalFilter struct {
	// From and Until bound the issue day, both included.
	From  *calendar.Date
	Until *calendar.Date
	// Issuer narrows to one issuer by its key; the Träger has the empty
	// key, so AnyIssuer says whether the key counts.
	Issuer    string
	AnyIssuer bool
	// Service and Year name a number range together with the issuer: the
	// service whose counter numbers the document and the year of the
	// counter. AnyYear says whether Year counts, since a range without a
	// year has the year 0.
	Service string
	Year    int
	AnyYear bool
	// DocumentType is one of JournalDocumentTypes.
	DocumentType string
	// RunKind and RunID name one run; RunID zero is every run.
	RunKind string
	RunID   int64
	// Search matches a part of the number, of the number of the document it
	// refers to or of the recipient's name.
	Search string
	// ReferenceNumber matches an entire document number or reference, not
	// the other fields of a text search.
	ReferenceNumber string
	// Status keeps the invoices in one state of JournalInvoiceStates (#8138).
	Status string
	// Sort names the column of JournalSorts that orders a page, Descending
	// its direction; empty keeps the order of the journal. A file always
	// stands by number range and number.
	Sort       string
	Descending bool
	Page       int
}

// JournalRun is the run a document was issued in. A holiday run carries the
// name of its period, a monthly run its month and a run of Jahresbescheide
// its year.
type JournalRun struct {
	Kind  string         `json:"kind"`
	ID    ident.ID       `json:"id"`
	Name  string         `json:"name"`
	Month *calendar.Date `json:"month"`
	Year  int            `json:"year"`
	// IssuedOn is the issue day of the run, where the run stands as a
	// choice of the filter: two runs of one period or month are told apart
	// by it. A later Storno does not move it. Nil on the run of a document.
	IssuedOn *calendar.Date `json:"issued_on"`
}

// JournalReference names the document another one belongs to.
type JournalReference struct {
	Kind   string `json:"kind"`
	Number string `json:"number"`
}

// JournalDocument is one issued document as the journal lists it. The
// amounts are in whole cent; a cancellation and a credit are negative.
// The contributions of the Elternabrechnung carry no tax (the positions
// allow none), so TaxCents is zero and the net amount is the gross amount.
type JournalDocument struct {
	// Key names the document across the three kinds of run.
	Key                string            `json:"key"`
	Number             string            `json:"number"`
	IssuedOn           calendar.Date     `json:"issued_on"`
	DocumentType       string            `json:"document_type"`
	RecipientFirstName string            `json:"recipient_first_name"`
	RecipientLastName  string            `json:"recipient_last_name"`
	Issuer             BillingIssuer     `json:"issuer"`
	Service            string            `json:"service"`
	NumberYear         int               `json:"number_year"`
	Run                JournalRun        `json:"run"`
	GrossCents         int64             `json:"gross_cents" contract:"number"`
	TaxCents           int64             `json:"tax_cents" contract:"number"`
	NetCents           int64             `json:"net_cents" contract:"number"`
	Reference          *JournalReference `json:"reference"`
	// Status and OpenCents are the state of an invoice and what it still
	// asks for, as its family shows them (#4691, #8138): nothing once it is
	// cancelled, otherwise its amount less its credits. moto sees no
	// payments, so open means not taken back. Empty and zero on a
	// cancellation and a credit, which ask for nothing of their own, and on
	// a Jahresbescheid: the families count invoices only, and the journal
	// shows the same sums.
	Status    string `json:"status"`
	OpenCents int64  `json:"open_cents" contract:"number"`
	// ChildNames are the first names of the children the document bills.
	ChildNames []string `json:"child_names"`
	// DebtorNumber is the family's number in the bookkeeping, empty
	// without one.
	DebtorNumber string `json:"debtor_number"`
	// FamilyID opens the family of the document
	// (BillingFamilies.BillingFamily); nil on a Jahresbescheid.
	FamilyID *ident.ID `json:"family_id"`
}

// JournalTotals are the sums of the documents that pass the filter, over
// every page.
type JournalTotals struct {
	GrossCents int64 `json:"gross_cents" contract:"number"`
	TaxCents   int64 `json:"tax_cents" contract:"number"`
	NetCents   int64 `json:"net_cents" contract:"number"`
	// OpenCents is what the invoices among them still ask for, without
	// the Jahresbescheide, as on the families.
	OpenCents int64 `json:"open_cents" contract:"number"`
}

// JournalNumberRange is a number range of the Träger that numbered at least
// one document, with the first and the last number it holds.
type JournalNumberRange struct {
	Issuer        BillingIssuer `json:"issuer"`
	Service       string        `json:"service"`
	Year          int           `json:"year"`
	DocumentCount int           `json:"document_count"`
	FirstNumber   string        `json:"first_number"`
	LastNumber    string        `json:"last_number"`
}

// JournalNumberGap is a run of numbers of a number range that no document
// carries. AfterNumber is the document before the gap, empty when the range
// starts with the gap; BeforeNumber the document after it, empty when the
// counter went on past the last document. A jump the Träger-Büro set as a
// start value (#7358) is no gap.
type JournalNumberGap struct {
	Issuer  BillingIssuer `json:"issuer"`
	Service string        `json:"service"`
	Year    int           `json:"year"`
	// FirstMissing is the running number of the first number that is
	// missing; MissingCount numbers are missing from there on.
	FirstMissing int64 `json:"first_missing" contract:"number"`
	MissingCount int64 `json:"missing_count" contract:"number"`
	// FirstMissingNumber and LastMissingNumber are the first and the last
	// missing number as a document would carry them, written like the
	// document beside the gap; empty when that document does not end its
	// number with its running number.
	FirstMissingNumber string `json:"first_missing_number"`
	LastMissingNumber  string `json:"last_missing_number"`
	AfterNumber        string `json:"after_number"`
	BeforeNumber       string `json:"before_number"`
}

// InvoiceJournalPage is one page of the journal with what the page around it
// needs: how many documents pass the filter and their sums, and, whatever
// the filter, every gap of the number ranges and every number range and run
// of the Träger. A gap stays in view while a filter narrows the list.
type InvoiceJournalPage struct {
	Documents []JournalDocument `json:"documents"`
	// TotalCount is every document that passes the filter, over all pages;
	// the page of the answer carries it (common.Pagination).
	TotalCount   int                  `json:"-"`
	Totals       JournalTotals        `json:"totals"`
	Gaps         []JournalNumberGap   `json:"gaps"`
	NumberRanges []JournalNumberRange `json:"number_ranges"`
	Runs         []JournalRun         `json:"runs"`
}

// InvoiceJournal lets the Abrechnung of a Träger read every issued document
// in one list (#4819). The read names the person of the session, runs in
// the Träger transaction of its Träger, which the caller opens, and is
// recorded in the trail of each run whose documents the page shows.
type InvoiceJournal interface {
	// InvoiceJournal reads one page of the journal, the newest document
	// first and, once the filter names a service, by number from the
	// highest down, or with the page zero every document by number range
	// and number. An unknown service, document type or kind of run and a period
	// that ends before it starts are validation errors.
	InvoiceJournal(ctx context.Context, reviewer HolidayReviewer, filter InvoiceJournalFilter) (InvoiceJournalPage, error)
}
