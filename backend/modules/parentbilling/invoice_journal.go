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

// InvoiceJournalPageSize is the number of documents one page of the journal
// carries.
const InvoiceJournalPageSize = 100

// MaxInvoiceJournalSearchLength bounds the search text of the journal.
const MaxInvoiceJournalSearchLength = 100

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
	Page   int
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
}

// JournalTotals are the sums of the documents that pass the filter, over
// every page.
type JournalTotals struct {
	GrossCents int64 `json:"gross_cents" contract:"number"`
	TaxCents   int64 `json:"tax_cents" contract:"number"`
	NetCents   int64 `json:"net_cents" contract:"number"`
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
	Documents    []JournalDocument    `json:"documents"`
	TotalCount   int                  `json:"total_count"`
	HasMore      bool                 `json:"has_more"`
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
	// first, or with the page zero every document by number range and
	// number. An unknown service, document type or kind of run and a period
	// that ends before it starts are validation errors.
	InvoiceJournal(ctx context.Context, reviewer HolidayReviewer, filter InvoiceJournalFilter) (InvoiceJournalPage, error)
}
