package application

import (
	"context"
	"fmt"
	"slices"
	"strings"

	"github.com/moto-ogs/project-phoenix/modules/parentbilling"
)

// One direct debit file per issuer (#8040, ADR 0322 point 8): a body that
// bills a school itself collects its invoices and notices with its own
// creditor identifier into its own account. The file of a run names one
// creditor, so the debits of each issuer form a file of their own; the
// Träger's file holds only the Träger's.

// debitsOfIssuer are the debits of the issuer issuerKey and every body with
// debits in the run, by name.
func debitsOfIssuer(debits []parentbilling.SealedSEPADebit, issuerKey string,
) ([]parentbilling.SealedSEPADebit, []parentbilling.BillingIssuer) {
	var mine []parentbilling.SealedSEPADebit
	issuers := []parentbilling.BillingIssuer{}
	for _, entry := range debits {
		if parentbilling.IssuerKeyOf(entry.Issuer) == issuerKey {
			mine = append(mine, entry)
		}
		if entry.Issuer != nil && !slices.ContainsFunc(issuers, func(known parentbilling.BillingIssuer) bool {
			return known.Key == entry.Issuer.Key
		}) {
			issuers = append(issuers, parentbilling.BillingIssuer{Key: entry.Issuer.Key, Body: entry.Issuer.Body, Name: entry.Issuer.Name})
		}
	}
	slices.SortFunc(issuers, func(a, b parentbilling.BillingIssuer) int { return strings.Compare(a.Name, b.Name) })
	return mine, issuers
}

// creditorOf sets the creditor of the file: the Träger's creditor
// identifier and default account, or the body's. A body takes its account
// now; one that no longer bills keeps the account its documents printed.
func (d *SEPADebits) creditorOf(ctx context.Context, reviewer parentbilling.HolidayReviewer, issuerKey string,
	debits []parentbilling.SealedSEPADebit, plan *debitPlan,
) error {
	if issuerKey == "" {
		creditor, err := d.store.SEPACreditor(ctx, reviewer.OrganizationID)
		if err != nil {
			return err
		}
		if creditor != nil {
			plan.run.CreditorID = creditor.CreditorID
		}
		plan.account, err = d.creditorAccount(ctx, reviewer)
		return err
	}
	plan.run.CreditorID = issuerKey
	for _, entry := range debits {
		if entry.Issuer != nil {
			printed := *entry.Issuer
			plan.run.Issuer, plan.account = &parentbilling.BillingIssuer{Key: printed.Key, Body: printed.Body, Name: printed.Name}, printed.BankAccount
			break
		}
	}
	current, err := d.letterheads.SchoolBillingIssuers(ctx, reviewer.OrganizationID, nil)
	if err != nil {
		return fmt.Errorf("parent billing: read the bodies that bill a school: %w", err)
	}
	for _, issuer := range parentbilling.DistinctIssuers(current) {
		if issuer.Key == issuerKey && issuer.BankAccount != nil {
			plan.run.Issuer = &parentbilling.BillingIssuer{Key: issuer.Key, Body: issuer.Body, Name: issuer.Name}
			plan.account = issuer.BankAccount
		}
	}
	return nil
}
