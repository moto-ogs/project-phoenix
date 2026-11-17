package application

import (
	"github.com/moto-ogs/project-phoenix/modules/parentbilling"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// The family a number belongs to today (#7356). A number is stored under
// the key its family had when it was stated or confirmed: the mail address
// of the invoice's recipient, or the contract itself for a family moto
// knows only by its contract (ContractFamilyKey, ADR 0232 point 7). Such a
// family can get a mail address later, alone or together with other
// contracts. Its number then goes with it:
//
//   - A number confirmed under the family's own key is its number.
//   - Without one, the numbers its contracts brought along count when they
//     say the same.
//   - When they differ, none counts by itself: the office decides, and its
//     confirmation is stored under the family's own key.

// countFamily is the family a stored number belongs to today: the one of
// the contract its key names for a number stored under a contract, else the
// key it was stored under. A contract the recipients do not name keeps its
// own key.
func countFamily(count parentbilling.FamilyChildCount, recipients map[int64]parentbilling.CareRecipient) string {
	contractID, ok := parentbilling.ContractOfFamily(count.FamilyEmail)
	if !ok {
		return count.FamilyEmail
	}
	return parentbilling.ContractFamilyKey(recipients[contractID].Email, contractID)
}

// familyNumbers are the stored numbers of one family: its own and those
// its contracts brought along.
type familyNumbers struct {
	own     *parentbilling.FamilyChildCount
	brought []*parentbilling.FamilyChildCount
}

// numbersByFamily groups the stored numbers by the family they belong to
// today, in the order of the counts.
func numbersByFamily(counts []parentbilling.FamilyChildCount, recipients map[int64]parentbilling.CareRecipient) (map[string]*familyNumbers, []string) {
	byFamily := map[string]*familyNumbers{}
	var order []string
	for i := range counts {
		family := countFamily(counts[i], recipients)
		numbers, ok := byFamily[family]
		if !ok {
			numbers = &familyNumbers{}
			byFamily[family] = numbers
			order = append(order, family)
		}
		if family == counts[i].FamilyEmail {
			numbers.own = &counts[i]
		} else {
			numbers.brought = append(numbers.brought, &counts[i])
		}
	}
	return byFamily, order
}

// contractID is a contract the family's numbers hang on.
func (n *familyNumbers) contractID() int64 {
	if n.own != nil {
		return n.own.ContractID
	}
	return n.brought[0].ContractID
}

// confirmed is the number the Abrechnung confirmed for the family, nil
// without one or while its contracts brought different numbers.
func (n *familyNumbers) confirmed() *parentbilling.FamilyChildCount {
	if count, differing := n.count(); !differing && count != nil && count.ConfirmedChildren != nil {
		return count
	}
	return nil
}

// decided tells whether the family's own number settles the question: the
// office confirmed one under the family's key.
func (n *familyNumbers) decided() bool {
	return n.own != nil && n.own.ConfirmedChildren != nil
}

// count is the number the office sees for the family: its own, else the one
// its contracts brought along. differing reports contracts that brought
// different confirmations; then no number is the family's.
func (n *familyNumbers) count() (count *parentbilling.FamilyChildCount, differing bool) {
	if n.decided() || len(n.brought) == 0 {
		return n.own, false
	}
	first := n.brought[0]
	for _, other := range n.brought[1:] {
		if !sameConfirmation(first, other) {
			return n.own, true
		}
	}
	return first, false
}

func sameConfirmation(a, b *parentbilling.FamilyChildCount) bool {
	return equalPtr(a.ConfirmedChildren, b.ConfirmedChildren) && equalPtr(a.ValidFrom, b.ValidFrom) && equalPtr(a.ValidUntil, b.ValidUntil)
}

func equalPtr[T comparable](a, b *T) bool {
	if a == nil || b == nil {
		return a == b
	}
	return *a == *b
}

// confirmedIn is the number that counts for the family in the month that
// starts on first: its own confirmation, else what its contracts brought
// along when every one valid in the month says the same.
func (n *familyNumbers) confirmedIn(first calendar.Date) (int, bool) {
	if n.decided() {
		return n.own.ConfirmedIn(first)
	}
	number, found := 0, false
	for _, count := range n.brought {
		brought, ok := count.ConfirmedIn(first)
		switch {
		case !ok:
		case found && brought != number:
			return 0, false
		default:
			number, found = brought, true
		}
	}
	return number, found
}

// endedBefore tells whether a confirmation of the family ended before day:
// its number ran out, where a family without one never had a number.
func (n *familyNumbers) endedBefore(day calendar.Date) bool {
	counts := n.brought
	if n.decided() {
		counts = []*parentbilling.FamilyChildCount{n.own}
	}
	for _, count := range counts {
		if count.ValidUntil != nil && count.ValidUntil.Before(day) {
			return true
		}
	}
	return false
}

// uncountedStates names per family a sibling rule ranked without a number
// why none counts in the month: its confirmation expired, or it has none.
func uncountedStates(uncounted map[string][]int64, counts []parentbilling.FamilyChildCount,
	recipients map[int64]parentbilling.CareRecipient, month calendar.Date,
) map[string]string {
	states := make(map[string]string, len(uncounted))
	if len(uncounted) == 0 {
		return states
	}
	byFamily, _ := numbersByFamily(counts, recipients)
	for family := range uncounted {
		states[family] = parentbilling.FamilyChildrenMissing
		if numbers, ok := byFamily[family]; ok && numbers.endedBefore(month) {
			states[family] = parentbilling.FamilyChildrenExpired
		}
	}
	return states
}
