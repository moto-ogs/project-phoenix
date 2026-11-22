package application

import (
	"context"
	"fmt"
	"slices"

	"github.com/moto-ogs/project-phoenix/modules/parentbilling"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// keepFamilies moves the deviation of each family that hangs on one of the
// contracts about to be deleted onto another contract of the same family
// (#7862). The deviation is the family's, not the contract's: a sibling's
// next invoice still needs its recipient, payment method and due day. A
// family without another contract loses its deviation with the cascade of
// its last contract, as before, so the row lives no longer than the
// family's contracts. A row a holiday registration used keeps its number
// either way (#6692). The trail of a deviation that stays follows it, also
// entries an office save left on an older contract of the family. due are
// the contracts whose period ended under the Weisung of rule; only those
// Care Contract will actually delete go, the others stay and can take a
// deviation (a termination without its last day stays, for one).
func (r *BelegRetention) keepFamilies(ctx context.Context, organizationID int64, due []int64, rule parentbilling.DueContract, today calendar.Date) error {
	going, err := r.contracts.DeletableContracts(ctx, organizationID, due, today, rule.TriggerEvent, rule.LastEventOn)
	if err != nil {
		return fmt.Errorf("parent billing: read the contracts that go: %w", err)
	}
	families, err := r.store.FamiliesOnContracts(ctx, organizationID, going)
	if err != nil {
		return err
	}
	moves := []parentbilling.FamilyMove{}
	if len(families) > 0 {
		if moves, err = r.familyMovesOf(ctx, organizationID, going, families, rule.TriggerEvent, today); err != nil {
			return err
		}
	}
	return r.store.MoveFamilies(ctx, organizationID, going, moves)
}

// familyMovesOf reads the contracts that stay and their families and picks
// the new contract of each family.
func (r *BelegRetention) familyMovesOf(ctx context.Context, organizationID int64, going []int64, families []parentbilling.FamilyOnContract,
	event string, today calendar.Date,
) ([]parentbilling.FamilyMove, error) {
	facts, err := r.contracts.ContractRetentionFacts(ctx, organizationID)
	if err != nil {
		return nil, fmt.Errorf("parent billing: read the contracts that stay: %w", err)
	}
	remaining := make([]parentbilling.ContractRetentionFact, 0, len(facts))
	for _, fact := range facts {
		if !slices.Contains(going, fact.ContractID) {
			remaining = append(remaining, fact)
		}
	}
	if len(remaining) == 0 {
		return nil, nil
	}
	ids := make([]int64, len(remaining))
	for i, fact := range remaining {
		ids[i] = fact.ContractID
	}
	emails, err := r.contracts.RecipientEmails(ctx, organizationID, ids)
	if err != nil {
		return nil, fmt.Errorf("parent billing: read the families of the contracts that stay: %w", err)
	}
	return familyMoves(families, remaining, emails, event, today), nil
}

// familyMoves picks for each family the contract of the family among
// remaining that the retention keeps longest: one in force today (also a
// termination whose last day is still ahead), then an ended one without the
// day of the Weisung's event (it waits on the
// clarification list), then the latest such day; among equals the newest
// contract.
func familyMoves(families []parentbilling.FamilyOnContract, remaining []parentbilling.ContractRetentionFact, emails map[int64]string,
	event string, today calendar.Date,
) []parentbilling.FamilyMove {
	moves := make([]parentbilling.FamilyMove, 0, len(families))
	for _, family := range families {
		best := parentbilling.ContractRetentionFact{}
		for _, fact := range remaining {
			email, known := emails[fact.ContractID]
			if !known || parentbilling.FamilyKey(email) != family.FamilyEmail {
				continue
			}
			if best.ContractID == 0 || staysLonger(fact, best, event, today) {
				best = fact
			}
		}
		if best.ContractID != 0 {
			moves = append(moves, parentbilling.FamilyMove{FamilyBillingID: family.FamilyBillingID, From: family.ContractID, To: best.ContractID})
		}
	}
	return moves
}

// staysLonger tells whether the retention keeps contract a longer than b
// under a Weisung counting from event on today.
func staysLonger(a, b parentbilling.ContractRetentionFact, event string, today calendar.Date) bool {
	day := func(fact parentbilling.ContractRetentionFact) *calendar.Date {
		if event == parentbilling.TriggerContractConcluded {
			return fact.ConcludedOn
		}
		return fact.EndedOn
	}
	rank := func(fact parentbilling.ContractRetentionFact) int {
		switch {
		case !fact.Ended || (fact.EndedOn != nil && fact.EndedOn.After(today)):
			return 2
		case day(fact) == nil:
			return 1
		default:
			return 0
		}
	}
	if rank(a) != rank(b) {
		return rank(a) > rank(b)
	}
	if da, db := day(a), day(b); rank(a) == 0 && da != nil && db != nil && *da != *db {
		return da.After(*db)
	}
	return a.ContractID > b.ContractID
}
