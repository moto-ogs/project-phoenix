package carecontract

import (
	"context"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// BillingChild is the identity of a contract's child for sibling counting.
type BillingChild struct {
	StudentID *int64
	FirstName string
	LastName  string
	BirthDate *calendar.Date
}

// ContractBilling is what the parents' billing reads of the contracts
// (#4681, #4684): the versions in force and the party each monthly invoice
// goes to. It runs in the Träger transaction the caller holds.
type ContractBilling interface {
	ContractVersions
	// FamiliesWithContracts returns the supplied family addresses that belong
	// to an existing contract of this Träger, including before an invoice exists.
	FamiliesWithContracts(ctx context.Context, organizationID int64, emails []string) ([]string, error)
	// BillingRecipients names per contract of the Träger the party its
	// invoice goes to: the first party with an e-mail address, else the
	// first party. A contract of another Träger or without a party has
	// none. Email stays the signed address, which keys the family;
	// AccountEmail is its parents account's address today (#8215).
	BillingRecipients(ctx context.Context, organizationID int64, contractIDs []int64) (map[int64]Party, error)
	// BillingChildren also reads ended contracts that no longer overlap the
	// billing month. Only the supplied contracts of this Träger are read.
	BillingChildren(ctx context.Context, organizationID int64, contractIDs []int64) (map[int64]BillingChild, error)
}

// AccountEmails reads the current addresses of parents accounts in the
// caller's Träger transaction: Identity & Access owns them. Accounts without
// an address are absent (#8215).
type AccountEmails interface {
	TraegerAccountEmails(ctx context.Context, organizationID int64, accountIDs []int64) (map[int64]string, error)
}
