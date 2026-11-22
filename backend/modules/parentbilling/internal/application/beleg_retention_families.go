package application

import (
	"context"
	"fmt"
	"slices"

	"github.com/moto-ogs/project-phoenix/modules/parentbilling"
)

// keepFamilies moves the deviation of each family that hangs on one of the
// contracts about to be deleted onto another contract of the same family
// (#7862). The deviation is the family's, not the contract's: a sibling's
// next invoice still needs its recipient, payment method and due day. A
// family without another contract loses its deviation with the cascade of
// its last contract, as before, so the row lives no longer than the
// family's contracts. A row a holiday registration used keeps its number
// either way (#6692).
func (r *BelegRetention) keepFamilies(ctx context.Context, organizationID int64, going []int64) error {
	families, err := r.store.FamiliesOnContracts(ctx, organizationID, going)
	if err != nil || len(families) == 0 {
		return err
	}
	facts, err := r.contracts.ContractRetentionFacts(ctx, organizationID)
	if err != nil {
		return fmt.Errorf("parent billing: read the contracts that stay: %w", err)
	}
	remaining := make([]parentbilling.ContractRetentionFact, 0, len(facts))
	for _, fact := range facts {
		if !slices.Contains(going, fact.ContractID) {
			remaining = append(remaining, fact)
		}
	}
	if len(remaining) == 0 {
		return nil
	}
	ids := make([]int64, len(remaining))
	for i, fact := range remaining {
		ids[i] = fact.ContractID
	}
	emails, err := r.contracts.RecipientEmails(ctx, organizationID, ids)
	if err != nil {
		return fmt.Errorf("parent billing: read the families of the contracts that stay: %w", err)
	}
	moves := familyMoves(families, remaining, emails)
	if len(moves) == 0 {
		return nil
	}
	return r.store.MoveFamilies(ctx, organizationID, moves)
}

// familyMoves picks for each family the contract of the family among
// remaining that stays longest: one in force, then an ended one without a
// last day (it waits on the clarification list), then the latest end;
// among equals the newest contract.
func familyMoves(families []parentbilling.FamilyOnContract, remaining []parentbilling.ContractRetentionFact, emails map[int64]string) []parentbilling.FamilyMove {
	moves := make([]parentbilling.FamilyMove, 0, len(families))
	for _, family := range families {
		best := parentbilling.ContractRetentionFact{}
		for _, fact := range remaining {
			email, known := emails[fact.ContractID]
			if !known || parentbilling.FamilyKey(email) != family.FamilyEmail {
				continue
			}
			if best.ContractID == 0 || staysLonger(fact, best) {
				best = fact
			}
		}
		if best.ContractID != 0 {
			moves = append(moves, parentbilling.FamilyMove{FamilyBillingID: family.FamilyBillingID, From: family.ContractID, To: best.ContractID})
		}
	}
	return moves
}

// staysLonger tells whether contract a is kept longer than b.
func staysLonger(a, b parentbilling.ContractRetentionFact) bool {
	rank := func(fact parentbilling.ContractRetentionFact) int {
		switch {
		case !fact.Ended:
			return 2
		case fact.EndedOn == nil:
			return 1
		default:
			return 0
		}
	}
	if rank(a) != rank(b) {
		return rank(a) > rank(b)
	}
	if a.EndedOn != nil && b.EndedOn != nil && *a.EndedOn != *b.EndedOn {
		return a.EndedOn.After(*b.EndedOn)
	}
	return a.ContractID > b.ContractID
}
