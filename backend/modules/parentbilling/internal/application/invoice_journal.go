package application

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"unicode/utf8"

	validation "github.com/go-ozzo/ozzo-validation"

	"github.com/moto-ogs/project-phoenix/modules/parentbilling"
)

// JournalStore reads the Rechnungsausgangsbuch of a Träger in its Träger
// transaction and records the read in the trails of the runs it shows. Its
// documents and sums carry their gross amount; the service adds the rest.
type JournalStore interface {
	ReadInvoiceJournal(ctx context.Context, organizationID, accountID int64, filter parentbilling.InvoiceJournalFilter) (parentbilling.InvoiceJournalPage, error)
}

var _ parentbilling.InvoiceJournal = (*BillingFamilies)(nil)

// InvoiceJournal reads one page of the Rechnungsausgangsbuch (#4819) and
// records the read in the trail of each run whose documents it shows.
func (f *BillingFamilies) InvoiceJournal(ctx context.Context, reviewer parentbilling.HolidayReviewer, filter parentbilling.InvoiceJournalFilter,
) (parentbilling.InvoiceJournalPage, error) {
	if err := validReviewer(reviewer); err != nil {
		return parentbilling.InvoiceJournalPage{}, err
	}
	filter.Search = strings.TrimSpace(filter.Search)
	if errs := journalFilterErrors(filter); len(errs) > 0 {
		return parentbilling.InvoiceJournalPage{}, errs
	}
	page, err := f.store.ReadInvoiceJournal(ctx, reviewer.OrganizationID, reviewer.AccountID, filter)
	if err != nil {
		return parentbilling.InvoiceJournalPage{}, fmt.Errorf("parent billing: read the invoice journal: %w", err)
	}
	// The positions of the Elternabrechnung allow no tax
	// (chk_document_positions_amounts, chk_care_invoice_positions_amounts):
	// the net amount of a document is its total, and so are the sums.
	for i := range page.Documents {
		page.Documents[i].TaxCents, page.Documents[i].NetCents = 0, page.Documents[i].GrossCents
	}
	page.Totals.TaxCents, page.Totals.NetCents = 0, page.Totals.GrossCents
	for i := range page.Gaps {
		page.Gaps[i].FirstMissingNumber, page.Gaps[i].LastMissingNumber = missingNumbers(page.Gaps[i])
	}
	return page, nil
}

// journalFilterErrors names what a filter of the journal cannot ask for.
func journalFilterErrors(filter parentbilling.InvoiceJournalFilter) validation.Errors {
	errs := validation.Errors{}
	if filter.From != nil && filter.Until != nil && filter.Until.Before(*filter.From) {
		errs["to"] = errors.New("must not lie before from")
	}
	if filter.Service != "" && !slices.Contains(parentbilling.InvoiceNumberServices, filter.Service) {
		errs["service"] = errors.New("is no service with a number range")
	}
	if filter.DocumentType != "" && !slices.Contains(parentbilling.JournalDocumentTypes, filter.DocumentType) {
		errs["document_type"] = errors.New("is no document type")
	}
	if filter.RunKind != "" && !slices.Contains(parentbilling.JournalRunKinds, filter.RunKind) {
		errs["run_kind"] = errors.New("is no kind of run")
	}
	if (filter.RunID != 0) != (filter.RunKind != "") || filter.RunID < 0 {
		errs["run_id"] = errors.New("a run is named by its kind and its ID")
	}
	if utf8.RuneCountInString(filter.Search) > parentbilling.MaxInvoiceJournalSearchLength {
		errs["search"] = errors.New("is too long")
	}
	if filter.Page < 0 {
		errs["page"] = errors.New("must not be negative")
	}
	return errs
}

// trailingDigits finds the digits a number ends with.
var trailingDigits = regexp.MustCompile(`[0-9]+$`)

// missingNumbers writes the first and the last missing number of a gap like
// a document beside it: the document before the gap, else the one after it.
// A number range writes its running number at the end of the number with
// leading zeros; a document that does not end with its own running number
// gives no way to write its neighbours. Without such a document on either
// side the answer is empty.
func missingNumbers(gap parentbilling.JournalNumberGap) (first, last string) {
	write := numberWriter(gap.AfterNumber, gap.FirstMissing-1)
	if write == nil {
		write = numberWriter(gap.BeforeNumber, gap.FirstMissing+gap.MissingCount)
	}
	if write == nil {
		return "", ""
	}
	return write(gap.FirstMissing), write(gap.FirstMissing + gap.MissingCount - 1)
}

// numberWriter writes running numbers like the document number, which
// carries the running number sequence; nil when number does not end with it.
func numberWriter(number string, sequence int64) func(int64) string {
	digits := trailingDigits.FindString(number)
	if value, err := strconv.ParseInt(digits, 10, 64); digits == "" || err != nil || value != sequence {
		return nil
	}
	prefix := strings.TrimSuffix(number, digits)
	return func(running int64) string {
		text := strconv.FormatInt(running, 10)
		return prefix + strings.Repeat("0", max(0, len(digits)-len(text))) + text
	}
}
