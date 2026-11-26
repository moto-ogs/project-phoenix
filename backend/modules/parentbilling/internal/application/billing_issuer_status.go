package application

import (
	"context"
	"fmt"
	"slices"

	"github.com/moto-ogs/project-phoenix/modules/documentrendering/templates"
	"github.com/moto-ogs/project-phoenix/modules/parentbilling"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

// The state of each body that bills a school of the Träger (#8040, ADR 0322
// point 11): what it still needs before its documents go out. The overview
// of the responsibilities shows it beside the master data of the body. It
// counts families and names none, so every member of the Träger reads it.

// BillingIssuerStatuses names per body its number ranges, kinds of
// document, whether a fee notice lacks its legal remedy, and the families
// that pay by direct debit at its schools today, with those without a
// mandate for its creditor identifier.
func (r *RequiredDetails) BillingIssuerStatuses(ctx context.Context, organizationID int64) (parentbilling.BillingIssuerOverview, error) {
	overview := parentbilling.BillingIssuerOverview{Issuers: []parentbilling.BillingIssuerStatus{}}
	if organizationID <= 0 {
		return overview, errTraegerRequired
	}
	schools, err := schoolIssuers(ctx, r.sources.Issuers, organizationID)
	if err != nil || len(schools) == 0 {
		return overview, err
	}
	ranges, err := r.store.ListNumberRanges(ctx, organizationID)
	if err != nil {
		return overview, fmt.Errorf("parent billing: read number ranges: %w", err)
	}
	chosen, err := r.store.DocumentKinds(ctx, organizationID)
	if err != nil {
		return overview, fmt.Errorf("parent billing: read document kinds: %w", err)
	}
	remedyMissing, err := r.legalRemedyMissing(ctx, organizationID)
	if err != nil {
		return overview, err
	}
	creditor, mandates, err := r.store.InvoiceDebitTerms(ctx, organizationID)
	if err != nil {
		return overview, fmt.Errorf("parent billing: read the SEPA creditor and mandates: %w", err)
	}
	families, err := r.debitFamilies(ctx, organizationID, schools, mandates)
	if err != nil {
		return overview, err
	}
	for _, issuer := range parentbilling.DistinctIssuers(schools)[1:] {
		status := issuerStatus(issuer, schools, ranges, chosen, remedyMissing)
		status.DirectDebitFamilies, status.FamiliesWithoutMandate = families[issuer.Key].debit, families[issuer.Key].missing
		status.CreditorIsTraegers = creditor != nil && creditor.CreditorID == issuer.Key
		overview.Issuers = append(overview.Issuers, status)
	}
	return overview, nil
}

// issuerStatus is the state of one body: its schools, its number range and
// its kind of document per service, and whether a fee notice of it lacks
// the legal remedy.
func issuerStatus(issuer parentbilling.BillingIssuer, schools map[int64]parentbilling.BillingIssuer, ranges []parentbilling.NumberRange,
	chosen map[string]map[string]parentbilling.ServiceDocumentKind, remedyMissing bool,
) parentbilling.BillingIssuerStatus {
	status := parentbilling.BillingIssuerStatus{Issuer: issuer, SchoolIDs: []ident.ID{},
		NumberRanges: []parentbilling.IssuerNumberRange{}, DocumentKinds: []parentbilling.ServiceDocumentKind{}}
	for schoolID, own := range schools {
		if own.Key == issuer.Key {
			status.SchoolIDs = append(status.SchoolIDs, ident.ID(schoolID))
		}
	}
	slices.Sort(status.SchoolIDs)
	for _, service := range documentKindServices {
		pattern, _ := patternOf(ranges, issuer.Key, service)
		status.NumberRanges = append(status.NumberRanges, parentbilling.IssuerNumberRange{Service: service, Pattern: pattern})
		kind := chosenKind(chosen, issuer.Key, service)
		status.DocumentKinds = append(status.DocumentKinds, parentbilling.ServiceDocumentKind{Service: service,
			DocumentKind: kind, Choices: parentbilling.DocumentKindChoices(service)})
		status.LegalRemedyMissing = status.LegalRemedyMissing || (kind == parentbilling.DocumentKindFeeNotice && remedyMissing)
	}
	return status
}

// legalRemedyMissing tells whether the Träger's template of the fee notice
// lacks its legal remedy; every issuer's fee notice takes it (ADR 0322
// point 6).
func (r *RequiredDetails) legalRemedyMissing(ctx context.Context, organizationID int64) (bool, error) {
	template, err := r.sources.Issuers.DocumentTemplate(ctx, organizationID, parentbilling.DocumentKindFeeNotice)
	if err != nil {
		return false, fmt.Errorf("parent billing: read the template of the fee notice: %w", err)
	}
	return templates.LacksLegalRemedy(templates.KindFeeNotice, letterTemplate(template, templates.KindFeeNotice, letterAddressee{})), nil
}

// issuerFamilies counts the families of an issuer that pay the care by
// direct debit and those of them without a mandate for its creditor.
type issuerFamilies struct {
	debit, missing int
}

// debitFamilies counts per body the families with a contract in force
// today at one of its schools that pay the monthly care by direct debit,
// and those without a mandate in force for its creditor identifier.
func (r *RequiredDetails) debitFamilies(ctx context.Context, organizationID int64, schools map[int64]parentbilling.BillingIssuer,
	mandates []parentbilling.SEPAMandate,
) (map[string]issuerFamilies, error) {
	today := r.today()
	versions, err := r.sources.Contracts.VersionsInForce(ctx, organizationID, today, today)
	if err != nil {
		return nil, fmt.Errorf("parent billing: read the contracts in force: %w", err)
	}
	contracts := map[int64]string{}
	for _, version := range versions {
		if issuer, ok := schools[version.SchoolID]; ok && !issuer.IsTraeger() {
			contracts[version.ContractID] = issuer.Key
		}
	}
	counts := map[string]issuerFamilies{}
	if len(contracts) == 0 {
		return counts, nil
	}
	ids := make([]int64, 0, len(contracts))
	for id := range contracts {
		ids = append(ids, id)
	}
	slices.Sort(ids)
	recipients, err := r.sources.Contracts.Recipients(ctx, organizationID, ids)
	if err != nil {
		return nil, fmt.Errorf("parent billing: read the contract parties: %w", err)
	}
	stored, deviations, _, err := r.store.InvoicePaymentTerms(ctx, organizationID, 0, 0)
	if err != nil {
		return nil, fmt.Errorf("parent billing: read the payment terms: %w", err)
	}
	return countDebitFamilies(ids, contracts, recipients, termsSetOf(stored).Of(parentbilling.ServiceCare), deviations, mandates, today), nil
}

// countDebitFamilies counts per issuer each family once that pays by direct
// debit, and whether it has a mandate in force for the issuer's creditor.
func countDebitFamilies(ids []int64, contracts map[int64]string, recipients map[int64]parentbilling.CareRecipient,
	terms parentbilling.ServiceTerms, deviations []parentbilling.FamilyBilling, mandates []parentbilling.SEPAMandate, today calendar.Date,
) map[string]issuerFamilies {
	byFamily := map[string]*parentbilling.FamilyBilling{}
	for i := range deviations {
		byFamily[deviations[i].FamilyEmail] = &deviations[i]
	}
	given := map[mandateKey]bool{}
	for _, mandate := range mandates {
		// An expired mandate collects nothing any more.
		used := parentbilling.MandateUsedOn(mandate.Sequence, mandate.LastCollectedOn, calendar.DateFromTime(mandate.CreatedAt))
		if parentbilling.MandateExpiresOn(mandate.SignedOn, used).After(today) {
			given[mandateKey{familyEmail: mandate.FamilyEmail, creditorID: mandate.CreditorID}] = true
		}
	}
	counts := map[string]issuerFamilies{}
	counted := map[mandateKey]bool{}
	for _, id := range ids {
		family := recipients[id].FamilyOf(id)
		key := mandateKey{familyEmail: family, creditorID: contracts[id]}
		if family == "" || counted[key] ||
			parentbilling.ResolvePayment(terms, parentbilling.RunDueDates{}, byFamily[family], today).Method != parentbilling.PaymentDirectDebit {
			continue
		}
		counted[key] = true
		count := counts[key.creditorID]
		count.debit++
		if !given[key] {
			count.missing++
		}
		counts[key.creditorID] = count
	}
	return counts
}
