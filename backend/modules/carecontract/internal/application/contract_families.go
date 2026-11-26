package application

import (
	"context"
	"fmt"
	"slices"

	"github.com/moto-ogs/project-phoenix/modules/carecontract"
	"github.com/moto-ogs/project-phoenix/modules/carecontract/internal/ports"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
	"github.com/moto-ogs/project-phoenix/sharedkernel/readstate"
)

// The families of the contracts without a mail address (#7161, ADR 0319).
// Every operation runs in the caller's Träger transaction and records the
// read of the contracts it answers in the trail.

// familiesView names the list in the trail.
const familiesView = "care_contract_families"

// ContractFamilies lists the contracts without a mail address with their
// families and records the read.
func (c *Contracts) ContractFamilies(ctx context.Context, reviewer carecontract.Reviewer) (carecontract.ContractFamilySet, error) {
	return c.withinFamilies(ctx, reviewer, func(context.Context) error { return nil })
}

// JoinContractFamily joins the contracts and every contract of their
// families to one family led by input.FamilyContractID.
func (c *Contracts) JoinContractFamily(ctx context.Context, reviewer carecontract.Reviewer, input carecontract.FamilyJoinInput) (carecontract.ContractFamilySet, error) {
	ids, lead, err := joinRequest(input)
	if err != nil {
		return carecontract.ContractFamilySet{}, err
	}
	return c.withinFamilies(ctx, reviewer, func(txCtx context.Context) error {
		states, err := c.lockedFamilyStates(txCtx, reviewer, ids, input.ExpectedVersion)
		if err != nil {
			return err
		}
		changes := make([]ports.FamilyChange, 0, len(states))
		for _, state := range states {
			if refusal := joinRefusal(state); refusal != nil {
				return refusal
			}
			next := lead
			if state.ContractID == lead {
				next = 0
			}
			if state.FamilyContractID != next {
				changes = append(changes, ports.FamilyChange{ContractID: state.ContractID, SchoolID: state.SchoolID,
					FamilyContractID: next, From: state.Lead()})
			}
		}
		return c.store.SetFamilies(txCtx, reviewer.OrganizationID, reviewer.AccountID, ports.ActionJoinFamily, changes)
	})
}

// LeaveContractFamily gives a contract led by another its own family back.
func (c *Contracts) LeaveContractFamily(ctx context.Context, reviewer carecontract.Reviewer, contractID int64, expectedVersion string) (carecontract.ContractFamilySet, error) {
	if contractID <= 0 {
		return carecontract.ContractFamilySet{}, carecontract.ErrContractNotFound
	}
	return c.withinFamilies(ctx, reviewer, func(txCtx context.Context) error {
		states, err := c.lockedFamilyStates(txCtx, reviewer, []int64{contractID}, expectedVersion)
		if err != nil {
			return err
		}
		var leaving ports.FamilyState
		leads := false
		for _, state := range states {
			switch {
			case state.ContractID == contractID:
				leaving = state
			case state.FamilyContractID == contractID:
				leads = true
			}
		}
		switch {
		case leads:
			return &carecontract.FamilyRefusal{Reason: carecontract.FamilyRefusedLeads, ContractID: contractID}
		case leaving.FamilyContractID == 0:
			return &carecontract.FamilyRefusal{Reason: carecontract.FamilyRefusedNotJoined, ContractID: contractID}
		}
		return c.store.SetFamilies(txCtx, reviewer.OrganizationID, reviewer.AccountID, ports.ActionLeaveFamily,
			[]ports.FamilyChange{{ContractID: contractID, SchoolID: leaving.SchoolID, From: leaving.Lead()}})
	})
}

// withinFamilies runs change, reads the families after it and records the
// read in the trail, all in the caller's Träger transaction.
func (c *Contracts) withinFamilies(ctx context.Context, reviewer carecontract.Reviewer, change func(context.Context) error) (carecontract.ContractFamilySet, error) {
	if err := checkReviewer(reviewer); err != nil {
		return carecontract.ContractFamilySet{}, err
	}
	if err := change(ctx); err != nil {
		return carecontract.ContractFamilySet{}, err
	}
	set, err := c.familySet(ctx, reviewer.OrganizationID)
	if err != nil || len(set.Contracts) == 0 {
		return set, err
	}
	ids := make([]int64, len(set.Contracts))
	for i, contract := range set.Contracts {
		ids[i] = contract.ContractID.Int64()
	}
	return set, trail(ctx, c.store, reviewer.OrganizationID, reviewer.AccountID, 0, 0, ActionRead,
		map[string]any{"view": familiesView, "contract_ids": ids})
}

// lockedFamilyStates takes the lock of the families, checks the version the
// office read and answers the named contracts with their families. A
// contract the Träger does not have is ErrContractNotFound.
func (c *Contracts) lockedFamilyStates(ctx context.Context, reviewer carecontract.Reviewer, ids []int64, expectedVersion string) ([]ports.FamilyState, error) {
	if err := c.store.LockFamilies(ctx, reviewer.OrganizationID); err != nil {
		return nil, err
	}
	contracts, err := c.store.FamilyContracts(ctx, reviewer.OrganizationID)
	if err != nil {
		return nil, err
	}
	if err := readstate.Check(expectedVersion, familiesVersion(contracts)); err != nil {
		return nil, err
	}
	states, err := c.store.FamilyStates(ctx, reviewer.OrganizationID, ids)
	if err != nil {
		return nil, err
	}
	for _, id := range ids {
		if !slices.ContainsFunc(states, func(state ports.FamilyState) bool { return state.ContractID == id }) {
			return nil, carecontract.ErrContractNotFound
		}
	}
	return states, nil
}

// familySet reads the contracts without a mail address and the newest
// changes of their families.
func (c *Contracts) familySet(ctx context.Context, organizationID int64) (carecontract.ContractFamilySet, error) {
	contracts, err := c.store.FamilyContracts(ctx, organizationID)
	if err != nil {
		return carecontract.ContractFamilySet{}, fmt.Errorf("care contract: read the families: %w", err)
	}
	events, err := c.store.FamilyEvents(ctx, organizationID, carecontract.FamilyEventLimit)
	if err != nil {
		return carecontract.ContractFamilySet{}, fmt.Errorf("care contract: read the trail of the families: %w", err)
	}
	return carecontract.ContractFamilySet{Version: familiesVersion(contracts), Contracts: contracts, Events: events}, nil
}

// familiesVersion is the token of the families as stored: every contract
// that another leads, with its leading contract, by contract. A contract
// joined to a family has no mail address and is no draft, so the list holds
// every one.
func familiesVersion(contracts []carecontract.FamilyMember) string {
	led := [][2]ident.ID{}
	for _, contract := range contracts {
		if contract.FamilyContractID != contract.ContractID {
			led = append(led, [2]ident.ID{contract.ContractID, contract.FamilyContractID})
		}
	}
	slices.SortFunc(led, func(a, b [2]ident.ID) int { return compareIDs(a[0].Int64(), b[0].Int64()) })
	return readstate.Fingerprint(led)
}

// joinRequest checks the choice: at least two different contracts, the
// leading one among them.
func joinRequest(input carecontract.FamilyJoinInput) ([]int64, int64, error) {
	ids := make([]int64, 0, len(input.ContractIDs))
	for _, id := range input.ContractIDs {
		if id <= 0 {
			return nil, 0, carecontract.InvalidSelection("contract_ids", "invalid")
		}
		if slices.Contains(ids, id.Int64()) {
			return nil, 0, carecontract.InvalidSelection("contract_ids", "repeated")
		}
		ids = append(ids, id.Int64())
	}
	if len(ids) < 2 {
		return nil, 0, carecontract.InvalidSelection("contract_ids", "too_few")
	}
	if !slices.Contains(ids, input.FamilyContractID.Int64()) {
		return nil, 0, carecontract.InvalidSelection("family_contract_id", "not_chosen")
	}
	return ids, input.FamilyContractID.Int64(), nil
}

// joinRefusal names why a contract may not join, nil when it may.
func joinRefusal(state ports.FamilyState) error {
	switch {
	case state.Draft:
		return &carecontract.FamilyRefusal{Reason: carecontract.FamilyRefusedDraft, ContractID: state.ContractID}
	case state.HasEmail:
		return &carecontract.FamilyRefusal{Reason: carecontract.FamilyRefusedHasEmail, ContractID: state.ContractID}
	}
	return nil
}
