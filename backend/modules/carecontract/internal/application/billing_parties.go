package application

import (
	"context"
	"fmt"
	"strings"

	"github.com/moto-ogs/project-phoenix/modules/carecontract"
)

// BillingStore reads versions, parties and children in the caller's Träger unit.
type BillingStore interface {
	Store
	ContractFamilyEmails(ctx context.Context, organizationID int64, emails []string) ([]string, error)
	PartiesOf(ctx context.Context, organizationID int64, contractIDs []int64) (map[int64][]carecontract.Party, error)
	ChildrenForBilling(ctx context.Context, organizationID int64, contractIDs []int64) (map[int64]carecontract.BillingChild, error)
}

// BillingReads serves carecontract.ContractBilling: the versions in force
// and the recipient of each monthly invoice (#4684).
type BillingReads struct {
	*Versions
	store BillingStore
}

var _ carecontract.ContractBilling = (*BillingReads)(nil)

// NewBillingReads builds the reads of the parents' billing.
func NewBillingReads(store BillingStore) *BillingReads {
	return &BillingReads{Versions: NewVersions(store), store: store}
}

func (b *BillingReads) BillingChildren(ctx context.Context, organizationID int64, contractIDs []int64) (map[int64]carecontract.BillingChild, error) {
	if organizationID <= 0 {
		return nil, &carecontract.ValidationError{Fields: map[string]string{"organization": "required"}}
	}
	if len(contractIDs) == 0 {
		return nil, nil
	}
	children, err := b.store.ChildrenForBilling(ctx, organizationID, contractIDs)
	if err != nil {
		return nil, fmt.Errorf("care contract: read billing children: %w", err)
	}
	// A retained contract without a record needs both a name and a birth
	// date. Do not match an anonymized or incomplete identity by name alone.
	for id, child := range children {
		if child.StudentID == nil && (child.BirthDate == nil || strings.TrimSpace(child.FirstName+child.LastName) == "") {
			delete(children, id)
		}
	}
	return children, nil
}

// BillingRecipients picks per contract the first party with an e-mail
// address, else the first party: the invoice goes where a mail can reach.
func (b *BillingReads) BillingRecipients(ctx context.Context, organizationID int64, contractIDs []int64) (map[int64]carecontract.Party, error) {
	if organizationID <= 0 {
		return nil, &carecontract.ValidationError{Fields: map[string]string{"organization": "required"}}
	}
	recipients := map[int64]carecontract.Party{}
	if len(contractIDs) == 0 {
		return recipients, nil
	}
	parties, err := b.store.PartiesOf(ctx, organizationID, contractIDs)
	if err != nil {
		return nil, fmt.Errorf("care contract: read contract parties: %w", err)
	}
	for contractID, list := range parties {
		recipients[contractID] = billingRecipient(list)
	}
	return recipients, nil
}

// billingRecipient is the first party with an e-mail address, else the
// first party; none for no party.
func billingRecipient(parties []carecontract.Party) carecontract.Party {
	if len(parties) == 0 {
		return carecontract.Party{}
	}
	for _, party := range parties {
		if party.Email != "" {
			return party
		}
	}
	return parties[0]
}

// FamiliesWithContracts normalizes family addresses and checks their contract
// membership in one read in the caller's Träger transaction.
func (b *BillingReads) FamiliesWithContracts(ctx context.Context, organizationID int64, emails []string) ([]string, error) {
	if organizationID <= 0 {
		return nil, &carecontract.ValidationError{Fields: map[string]string{"organization": "required"}}
	}
	keys := make([]string, 0, len(emails))
	seen := make(map[string]bool, len(emails))
	for _, email := range emails {
		key := strings.ToLower(strings.TrimSpace(email))
		if key != "" && !seen[key] {
			keys = append(keys, key)
			seen[key] = true
		}
	}
	if len(keys) == 0 {
		return []string{}, nil
	}
	families, err := b.store.ContractFamilyEmails(ctx, organizationID, keys)
	if err != nil {
		return nil, fmt.Errorf("care contract: read families with contracts: %w", err)
	}
	return families, nil
}
