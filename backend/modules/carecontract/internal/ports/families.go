package ports

import (
	"context"

	"github.com/moto-ogs/project-phoenix/modules/carecontract"
)

// The actions of the trail of a family (#7161, ADR 0319).
const (
	ActionJoinFamily  = carecontract.FamilyActionJoin
	ActionLeaveFamily = carecontract.FamilyActionLeave
)

// FamilyState is what a change of a family checks about a contract.
// FamilyContractID is the stored leading contract, zero when the contract
// leads or is alone.
type FamilyState struct {
	ContractID       int64
	SchoolID         int64
	FamilyContractID int64
	Draft            bool
	HasEmail         bool
}

// Lead is the leading contract of the contract's family.
func (s FamilyState) Lead() int64 {
	if s.FamilyContractID > 0 {
		return s.FamilyContractID
	}
	return s.ContractID
}

// FamilyChange sets the leading contract of one contract; zero takes it
// off. From is the leading contract before, as Lead answers it.
type FamilyChange struct {
	ContractID       int64
	SchoolID         int64
	FamilyContractID int64
	From             int64
}

// FamilyStore keeps the families of the contracts without a mail address
// in the Träger transaction of their Träger.
type FamilyStore interface {
	// LockFamilies serializes the changes of the families of the Träger
	// until the transaction ends.
	LockFamilies(ctx context.Context, organizationID int64) error
	// FamilyContracts reads every contract of the Träger that is no draft
	// and whose parties have no mail address, by the child's name.
	FamilyContracts(ctx context.Context, organizationID int64) ([]carecontract.FamilyMember, error)
	// FamilyStates reads the named contracts of the Träger and every
	// contract of their families. A contract of another Träger is missing.
	FamilyStates(ctx context.Context, organizationID int64, contractIDs []int64) ([]FamilyState, error)
	// SetFamilies stores the changes and their trail in one statement each.
	SetFamilies(ctx context.Context, organizationID, accountID int64, action string, changes []FamilyChange) error
	// FamilyEvents reads the newest joins and leaves of the Träger.
	FamilyEvents(ctx context.Context, organizationID int64, limit int) ([]carecontract.FamilyEvent, error)
}
