package application

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strings"

	"github.com/moto-ogs/project-phoenix/modules/parentbilling"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// The issuer of a document (#8040, ADR 0321): who bills the parents of its
// school. A release numbers the documents of each issuer from that issuer's
// range and freezes the issuer on them; the letters print the issuer's
// sender, contact and bank account.

// byIssuer orders documents by their issuer in place, the Träger first and
// each issuer's in their order, and answers the part of documents each
// issuer has: a release numbers each part from its issuer's range.
func byIssuer[T any](documents []T, keyOf func(T) string) [][]T {
	slices.SortStableFunc(documents, func(a, b T) int { return strings.Compare(keyOf(a), keyOf(b)) })
	var groups [][]T
	for start := 0; start < len(documents); {
		end := start + 1
		for end < len(documents) && keyOf(documents[end]) == keyOf(documents[start]) {
			end++
		}
		groups = append(groups, documents[start:end:end])
		start = end
	}
	return groups
}

// issuerPatterns reads the pattern of the service of every issuer of the
// documents; an issuer without one is a NumberRangeMissingError.
func issuerPatterns(ctx context.Context, store numberRangeReader, organizationID int64, service string, issuers []*parentbilling.BillingIssuer,
) (map[string]string, error) {
	patterns := map[string]string{}
	for _, issuer := range issuers {
		key := parentbilling.IssuerKeyOf(issuer)
		if _, ok := patterns[key]; ok {
			continue
		}
		named := parentbilling.TraegerIssuer()
		if issuer != nil {
			named = *issuer
		}
		pattern, err := numberPatternOf(ctx, store, organizationID, named, service)
		if err != nil {
			return nil, err
		}
		patterns[key] = pattern
	}
	return patterns, nil
}

// releaseStore reads the number ranges and the creditor of the Träger.
type releaseStore interface {
	numberRangeReader
	InvoiceDebitTerms(ctx context.Context, organizationID int64) (*parentbilling.SEPACreditor, []parentbilling.SEPAMandate, error)
}

// releasePatterns are the patterns a release numbers from. A body that
// bills with the creditor identifier of the Träger is refused first (ADR
// 0321 point 10): it would collect under the Träger's identifier into its
// own account and count numbers of its own beside the Träger's.
func releasePatterns(ctx context.Context, store releaseStore, organizationID int64, service string, issuers []*parentbilling.BillingIssuer,
) (map[string]string, error) {
	if !traegerIssuesOnly(issuers) {
		creditor, _, err := store.InvoiceDebitTerms(ctx, organizationID)
		if err != nil {
			return nil, err
		}
		for _, issuer := range issuers {
			if issuer != nil && creditor != nil && issuer.Key == creditor.CreditorID {
				return nil, &parentbilling.IssuerCreditorConflictError{Issuer: *issuer}
			}
		}
	}
	return issuerPatterns(ctx, store, organizationID, service, issuers)
}

// traegerIssuesOnly tells whether the Träger issues every document.
func traegerIssuesOnly(issuers []*parentbilling.BillingIssuer) bool {
	for _, issuer := range issuers {
		if issuer != nil {
			return false
		}
	}
	return true
}

// numberRangeState names the pattern a run shows: the pattern of the first
// issuer of its documents (the Träger without one), or, when an issuer has
// none, that issuer (#8040). The release refuses then.
func numberRangeState(ctx context.Context, store numberRangeReader, organizationID int64, service string,
	issuers []*parentbilling.BillingIssuer,
) (string, *parentbilling.BillingIssuer, error) {
	if len(issuers) == 0 {
		issuers = []*parentbilling.BillingIssuer{nil}
	}
	patterns, err := issuerPatterns(ctx, store, organizationID, service, issuers)
	var missing *parentbilling.NumberRangeMissingError
	switch {
	case errors.As(err, &missing):
		return "", &missing.Issuer, nil
	case err != nil:
		return "", nil, err
	}
	return patterns[parentbilling.IssuerKeyOf(issuers[0])], nil, nil
}

// issuerLetterhead is the letterhead a document of the issuer prints: the
// Träger's own, or for a body its sender, contact and bank account in place
// of the Träger's, without the logo and the footer of the Träger (ADR 0318
// §5, ADR 0321). The template, the colour and the payment text stay.
func issuerLetterhead(head parentbilling.Letterhead, issuer *parentbilling.BillingIssuer) parentbilling.Letterhead {
	if issuer == nil || issuer.IsTraeger() {
		return head
	}
	head.Logo, head.FooterText = nil, ""
	head.SenderText = issuer.SenderText
	head.ContactName, head.ContactPhone, head.ContactEmail = issuer.ContactName, issuer.ContactPhone, issuer.ContactEmail
	head.BankAccount = issuer.BankAccount
	return head
}

// schoolIssuers reads the issuer of every school of the Träger.
func schoolIssuers(ctx context.Context, issuers parentbilling.BillingIssuers, organizationID int64) (map[int64]parentbilling.BillingIssuer, error) {
	schools, err := issuers.SchoolBillingIssuers(ctx, organizationID, nil)
	if err != nil {
		return nil, fmt.Errorf("parent billing: read the issuers of the schools: %w", err)
	}
	return schools, nil
}

// issuerFingerprint is what a fingerprint of a review covers of a body that
// issues a document: everything its letter prints. Nil for the Träger, so a
// run without a body keeps the fingerprint it had before #8040.
type issuerFingerprint struct {
	Key          string                               `json:"key"`
	Body         string                               `json:"body"`
	SenderText   string                               `json:"sender_text"`
	ContactName  string                               `json:"contact_name"`
	ContactPhone string                               `json:"contact_phone"`
	ContactEmail string                               `json:"contact_email"`
	BankAccount  *parentbilling.LetterheadBankAccount `json:"bank_account"`
}

func fingerprintIssuer(issuer *parentbilling.BillingIssuer) *issuerFingerprint {
	if issuer == nil || issuer.IsTraeger() {
		return nil
	}
	return &issuerFingerprint{Key: issuer.Key, Body: issuer.Body, SenderText: issuer.SenderText, ContactName: issuer.ContactName,
		ContactPhone: issuer.ContactPhone, ContactEmail: issuer.ContactEmail, BankAccount: issuer.BankAccount}
}

// mailSenderOf is the name the mail of a document goes out with: the body
// that issued it, else the Träger (#8040).
func mailSenderOf(issuer *parentbilling.BillingIssuer, traeger string) string {
	if issuer == nil || issuer.IsTraeger() {
		return traeger
	}
	return issuer.Name
}

// traegerIssues tells whether the Träger issues one of the documents, or
// whether there is none: a run without a document still asks the Träger.
func traegerIssues(issuers []*parentbilling.BillingIssuer) bool {
	for _, issuer := range issuers {
		if issuer == nil || issuer.IsTraeger() {
			return true
		}
	}
	return len(issuers) == 0
}

// careIssuers, documentIssuers and noticeIssuers list the issuer of every
// document, nil for the Träger.
func careIssuers(invoices []parentbilling.CareInvoice) []*parentbilling.BillingIssuer {
	issuers := make([]*parentbilling.BillingIssuer, len(invoices))
	for i, invoice := range invoices {
		issuers[i] = invoice.Issuer
	}
	return issuers
}

func documentIssuers(documents []parentbilling.BillingDocument) []*parentbilling.BillingIssuer {
	issuers := make([]*parentbilling.BillingIssuer, len(documents))
	for i, document := range documents {
		issuers[i] = document.Issuer
	}
	return issuers
}

func noticeIssuers(notices []parentbilling.CareNotice) []*parentbilling.BillingIssuer {
	issuers := make([]*parentbilling.BillingIssuer, len(notices))
	for i, notice := range notices {
		issuers[i] = notice.Issuer
	}
	return issuers
}

// childIssuers names the issuer of every child of the registrations (#8040,
// ADR 0321 point 3): the issuer of the school the child attends, or for a
// holiday guest the issuer of the host school of its first booked week, the
// place of care of its contract. It answers the issuers of the schools too.
func (b *BillingRuns) childIssuers(ctx context.Context, reviewer parentbilling.HolidayReviewer, run parentbilling.BillingRun,
	registrations []parentbilling.HolidayBillingRegistration, contributions map[int64]parentbilling.HolidayContribution,
) (map[int64]parentbilling.BillingIssuer, map[int64]*parentbilling.BillingIssuer, error) {
	issuers, err := schoolIssuers(ctx, b.kinds.templates, reviewer.OrganizationID)
	if err != nil {
		return nil, nil, err
	}
	children := map[int64]*parentbilling.BillingIssuer{}
	if len(issuers) == 0 {
		return issuers, children, nil
	}
	var hosts []parentbilling.HolidayWeekHost
	for _, registration := range registrations {
		for _, child := range registration.Children {
			if child.HomeSchoolID != nil {
				children[child.ID] = parentbilling.IssuerOf(issuers, *child.HomeSchoolID)
				continue
			}
			if hosts == nil {
				if hosts, err = b.registrations.HolidayWeekHosts(ctx, reviewer, run.HolidayPeriodID.Int64()); err != nil {
					return nil, nil, fmt.Errorf("parent billing: read the host schools of the weeks: %w", err)
				}
			}
			children[child.ID] = parentbilling.IssuerOf(issuers, firstHost(contributions[registration.ID], child.ID, hosts))
		}
	}
	return issuers, children, nil
}

// firstHost is the host school of the earliest week the contribution of the
// child prices, 0 without one.
func firstHost(contribution parentbilling.HolidayContribution, childID int64, hosts []parentbilling.HolidayWeekHost) int64 {
	var host int64
	var first calendar.Date
	for _, child := range contribution.Children {
		if child.ChildID.Int64() != childID {
			continue
		}
		for _, line := range child.Lines {
			if line.WeekStartsOn == nil || (host != 0 && !line.WeekStartsOn.Before(first)) {
				continue
			}
			if school := hostOf(*line.WeekStartsOn, hosts); school != 0 {
				host, first = school, *line.WeekStartsOn
			}
		}
	}
	return host
}

// hostOf is the host school of the week the day lies in, 0 without one.
func hostOf(day calendar.Date, hosts []parentbilling.HolidayWeekHost) int64 {
	for _, week := range hosts {
		if !day.Before(week.StartsOn) && !day.After(week.EndsOn) {
			return week.HostSchoolID
		}
	}
	return 0
}

// mandateKey names the mandate in force of a family for a creditor
// identifier: a mandate holds only for the creditor it was given to
// (#8040, ADR 0321).
type mandateKey struct {
	familyEmail string
	creditorID  string
}

// creditorOf is the creditor an invoice of the issuer collects for: the
// Träger's, or the body's creditor identifier with the Träger's lead of the
// pre-notification and its choice for a debit without a mandate (ADR 0321
// point 8).
func (p invoicePayments) creditorOf(issuer *parentbilling.BillingIssuer) parentbilling.SEPACreditor {
	if issuer == nil || issuer.IsTraeger() {
		return p.creditor
	}
	creditor := p.creditor
	creditor.CreditorID = issuer.Key
	return creditor
}

// debit completes a payment by direct debit with the family's mandate for
// the creditor of the issuer and notes its read (ResolveDebit).
func (p invoicePayments) debit(payment parentbilling.InvoicePayment, terms parentbilling.ServiceTerms, family *parentbilling.FamilyBilling,
	familyEmail string, issuer *parentbilling.BillingIssuer, issuedOn calendar.Date,
) parentbilling.InvoicePayment {
	if payment.Method != parentbilling.PaymentDirectDebit {
		return payment
	}
	creditor := p.creditorOf(issuer)
	mandate := p.mandates[mandateKey{familyEmail: familyEmail, creditorID: creditor.CreditorID}]
	if mandate == nil && (issuer == nil || issuer.IsTraeger()) {
		// A mandate the family gave the Träger under an earlier creditor
		// identifier, or before it entered one, names why it does not
		// collect (DebitGapCreditorChanged, DebitGapCreditor).
		mandate = p.earlierTraegerMandate(familyEmail)
	}
	if mandate != nil {
		p.usedMandates[mandate.ID.Int64()] = *mandate
	}
	return parentbilling.ResolveDebit(payment, terms, p.run, family, issuedOn, creditor, mandate)
}

// earlierTraegerMandate is a mandate in force the family gave the Träger
// for another creditor identifier than its current one: none of a body that
// bills now. The lowest ID wins; nil without one.
func (p invoicePayments) earlierTraegerMandate(familyEmail string) *parentbilling.SEPAMandate {
	var found *parentbilling.SEPAMandate
	for key, mandate := range p.mandates {
		if key.familyEmail != familyEmail || p.bodyCreditors[key.creditorID] {
			continue
		}
		if found == nil || mandate.ID < found.ID {
			found = mandate
		}
	}
	return found
}

// withIssuers names the bodies that bill now (#8040).
func (p *invoicePayments) withIssuers(issuers map[int64]parentbilling.BillingIssuer) {
	p.bodyCreditors = make(map[string]bool, len(issuers))
	for _, issuer := range issuers {
		if !issuer.IsTraeger() {
			p.bodyCreditors[issuer.Key] = true
		}
	}
}
