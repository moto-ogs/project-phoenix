package application

import (
	"slices"

	"github.com/moto-ogs/project-phoenix/modules/parentbilling"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

// familyRecipientContracts includes contracts outside the billing or import
// window whose stored numbers still belong to a family in that window.
func familyRecipientContracts(ids []int64, counts []parentbilling.FamilyChildCount) []int64 {
	ids = slices.Clone(ids)
	seen := make(map[int64]bool, len(ids)+len(counts))
	for _, id := range ids {
		seen[id] = true
	}
	for _, count := range counts {
		id := count.ContractID
		if contractID, ok := parentbilling.ContractOfFamily(count.FamilyEmail); ok {
			id = ident.ID(contractID)
		}
		if !seen[id.Int64()] {
			ids = append(ids, id.Int64())
			seen[id.Int64()] = true
		}
	}
	return ids
}

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
		return n.own.ContractID.Int64()
	}
	return n.brought[0].ContractID.Int64()
}

// confirmed is the number the Abrechnung confirmed for the family, nil
// without one or while its contracts brought different numbers.
func (n *familyNumbers) confirmed() *parentbilling.FamilyChildCount {
	if count, differing := n.count(); !differing && count != nil && count.ConfirmedChildren != nil {
		return count
	}
	return nil
}

// all are the stored numbers of the family: its own and those its
// contracts brought along.
func (n *familyNumbers) all() []*parentbilling.FamilyChildCount {
	if n.own == nil {
		return n.brought
	}
	return append([]*parentbilling.FamilyChildCount{n.own}, n.brought...)
}

// decided tells whether the family's own number settles the question: the
// office confirmed one under the family's key.
func (n *familyNumbers) decided() bool {
	return n.own != nil && n.own.ConfirmedChildren != nil
}

// count protects the stored confirmations during import, including future
// ones. The office's dated view resolves them separately in countOn.
func (n *familyNumbers) count() (count *parentbilling.FamilyChildCount, differing bool) {
	if n.decided() || len(n.brought) == 0 {
		return n.own, false
	}
	first := n.brought[0]
	for _, other := range n.brought[1:] {
		if !sameConfirmation(first, other) {
			return n.own, true
		}
		// Equal numbers remain confirmed while any source still holds.
		// After all expire, renewal must also follow the last expiry.
		if first.ValidUntil != nil && (other.ValidUntil == nil || other.ValidUntil.After(*first.ValidUntil)) {
			first = other
		}
	}
	return first, false
}

// countOn combines the current confirmation with the latest parental
// statement for the office. Import decisions keep count's longest validity
// so that they also protect confirmations scheduled for a later day.
func (n *familyNumbers) countOn(day calendar.Date) (*parentbilling.FamilyChildCount, bool) {
	count, _ := n.count()
	ownStarted := false
	if n.decided() {
		_, ownStarted = n.own.InForceOn(day)
	}
	if !ownStarted && n.broughtDifferOn(day) {
		return n.withStatement(nil), true
	}
	if !n.decided() {
		if current := n.broughtCoverageOn(day); current != nil {
			count = current
		}
	} else if n.decided() && !ownStarted {
		count = n.withBroughtCoverage(day)
	}
	return n.withStatement(count), false
}

// statusOn follows the carried timeline until an own confirmation starts,
// distinguishing a gap from a scheduled change of number.
func (n *familyNumbers) statusOn(count *parentbilling.FamilyChildCount, day calendar.Date) string {
	status := familyChildrenStatus(count, day)
	if n.decided() {
		if _, started := n.own.InForceOn(day); started {
			return status
		}
	}
	if status != parentbilling.FamilyChildrenConfirmed && status != parentbilling.FamilyChildrenUpcoming && status != parentbilling.FamilyChildrenExpiring {
		return status
	}
	if _, valid := n.confirmedOn(day); !valid {
		return status
	}
	for _, change := range familyNumberChangesAfter(n.all(), day) {
		if change.After(day.AddDays(parentbilling.FamilyChildrenExpiryNotice + 1)) {
			break
		}
		if _, valid := n.confirmedOn(change); !valid {
			return parentbilling.FamilyChildrenExpiring
		}
	}
	if status == parentbilling.FamilyChildrenExpiring {
		if count.ValidFrom.After(day) {
			return parentbilling.FamilyChildrenUpcoming
		}
		return parentbilling.FamilyChildrenConfirmed
	}
	return status
}

// broughtDifferOn checks the confirmations that actually hold on the day,
// including retained ones below equal confirmations scheduled for later.
func (n *familyNumbers) broughtDifferOn(day calendar.Date) bool {
	var number *int
	for _, source := range n.brought {
		confirmation, _ := source.InForceOn(day)
		if children, ok := validFamilyConfirmation(confirmation, day); ok {
			if number != nil && *number != children {
				return true
			}
			number = &children
		}
	}
	return false
}

// withBroughtCoverage retains coverage before the first own confirmation
// for the list's gap warning, without changing the import or billing input.
func (n *familyNumbers) withBroughtCoverage(day calendar.Date) *parentbilling.FamilyChildCount {
	current := n.broughtCoverageOn(day)
	if current == nil {
		return n.own
	}
	until := current.ValidUntil
	for _, own := range confirmations(n.own) {
		if own.Children != nil && own.ValidFrom != nil {
			end := own.ValidFrom.AddDays(-1)
			if until == nil || end.Before(*until) {
				until = &end
			}
		}
	}
	combined := *n.own
	combined.Confirmations = append(slices.Clone(n.own.Confirmations), parentbilling.FamilyChildConfirmation{
		Children: current.ConfirmedChildren, ValidFrom: current.ValidFrom, ValidUntil: until,
	})
	return &combined
}

// broughtCoverageOn joins equal confirmations only across adjacent days.
// A gap must remain visible even if an open confirmation follows later.
func (n *familyNumbers) broughtCoverageOn(day calendar.Date) *parentbilling.FamilyChildCount {
	count := n.broughtOn(day)
	if count == nil || (count.ValidUntil != nil && count.ValidUntil.Before(day)) {
		return count
	}
	for _, change := range familyNumberChangesAfter(n.brought, day) {
		next := n.broughtOn(change)
		if next == nil || n.broughtDifferOn(change) || !sameConfirmation(count, next) ||
			(next.ValidUntil != nil && next.ValidUntil.Before(change)) {
			until := change.AddDays(-1)
			count.ValidUntil = &until
			return count
		}
	}
	count.ValidUntil = nil
	return count
}

// familyNumberChangesAfter lists all boundaries at which a confirmation can
// start, supersede another or expire. Obsolete boundaries change no outcome.
func familyNumberChangesAfter(counts []*parentbilling.FamilyChildCount, day calendar.Date) []calendar.Date {
	seen := map[calendar.Date]bool{}
	for _, count := range counts {
		for _, confirmation := range confirmations(count) {
			if confirmation.Children == nil || confirmation.ValidFrom == nil {
				continue
			}
			if confirmation.ValidFrom.After(day) {
				seen[*confirmation.ValidFrom] = true
			}
			if confirmation.ValidUntil != nil && !confirmation.ValidUntil.Before(day) {
				seen[confirmation.ValidUntil.AddDays(1)] = true
			}
		}
	}
	changes := make([]calendar.Date, 0, len(seen))
	for change := range seen {
		changes = append(changes, change)
	}
	slices.Sort(changes)
	return changes
}

// broughtOn chooses a confirmation valid today, else the last expired one.
// It includes retained confirmations of sources with a future change.
func (n *familyNumbers) broughtOn(day calendar.Date) *parentbilling.FamilyChildCount {
	var current *parentbilling.FamilyChildCount
	for _, source := range n.brought {
		confirmation, started := source.InForceOn(day)
		if !started {
			continue
		}
		copy := *source
		copy.ConfirmedChildren, copy.ValidFrom, copy.ValidUntil = confirmation.Children, confirmation.ValidFrom, confirmation.ValidUntil
		if preferFamilyCount(current, &copy, day) {
			current = &copy
		}
	}
	return current
}

func preferFamilyCount(current, candidate *parentbilling.FamilyChildCount, day calendar.Date) bool {
	if current == nil {
		return true
	}
	currentValid := current.ValidUntil == nil || !current.ValidUntil.Before(day)
	candidateValid := candidate.ValidUntil == nil || !candidate.ValidUntil.Before(day)
	if currentValid != candidateValid {
		return candidateValid
	}
	return current.ValidUntil != nil && (candidate.ValidUntil == nil || candidate.ValidUntil.After(*current.ValidUntil))
}

// withStatement keeps the latest statement across all sources without
// mutating the stored confirmation or inventing one for a differing family.
func (n *familyNumbers) withStatement(count *parentbilling.FamilyChildCount) *parentbilling.FamilyChildCount {
	var latest *parentbilling.FamilyChildCount
	for _, source := range n.all() {
		if source.StatedChildren != nil && source.StatedAt != nil &&
			(latest == nil || source.StatedAt.After(*latest.StatedAt)) {
			latest = source
		}
	}
	if latest == nil {
		return count
	}
	var combined parentbilling.FamilyChildCount
	if count != nil {
		combined = *count
	} else {
		combined.ID, combined.ContractID = latest.ID, latest.ContractID
	}
	combined.StatedChildren, combined.StatedAt = latest.StatedChildren, latest.StatedAt
	return &combined
}

// sameConfirmation tells whether two contracts brought the same number.
// The run compares the numbers valid in its month (confirmedIn), so the
// list compares the numbers too, not their days.
func sameConfirmation(a, b *parentbilling.FamilyChildCount) bool {
	return equalPtr(a.ConfirmedChildren, b.ConfirmedChildren)
}

func equalPtr[T comparable](a, b *T) bool {
	if a == nil || b == nil {
		return a == b
	}
	return *a == *b
}

// confirmedIn is the number that counts for the family in the month that
// starts on first: the first day's number, else the first valid number
// within the month, resolving both sources on each day before choosing.
func (n *familyNumbers) confirmedIn(first calendar.Date) (int, bool) {
	for day, end := first, monthEnd(first); !day.After(end); day = day.AddDays(1) {
		if number, ok := n.confirmedOn(day); ok {
			return number, true
		}
	}
	return 0, false
}

// confirmedOn resolves the family's own and brought confirmations on one
// day. Once an own confirmation starts it supersedes the brought ones,
// including after its expiry.
func (n *familyNumbers) confirmedOn(day calendar.Date) (int, bool) {
	if n.decided() {
		if confirmation, started := n.own.InForceOn(day); started {
			return validFamilyConfirmation(confirmation, day)
		}
	}
	number, found := 0, false
	for _, count := range n.brought {
		confirmation, _ := count.InForceOn(day)
		brought, ok := validFamilyConfirmation(confirmation, day)
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

func validFamilyConfirmation(confirmation parentbilling.FamilyChildConfirmation, day calendar.Date) (int, bool) {
	if confirmation.Children == nil || (confirmation.ValidUntil != nil && confirmation.ValidUntil.Before(day)) {
		return 0, false
	}
	return *confirmation.Children, true
}

// confirmations are the confirmations of a number, the current one first.
func confirmations(count *parentbilling.FamilyChildCount) []parentbilling.FamilyChildConfirmation {
	return append([]parentbilling.FamilyChildConfirmation{{Children: count.ConfirmedChildren, ValidFrom: count.ValidFrom, ValidUntil: count.ValidUntil}},
		count.Confirmations...)
}

// endedBefore tells whether a confirmation of the family, a retained one
// included, ended before day: its number ran out, where a family without
// one never had a number.
func (n *familyNumbers) endedBefore(day calendar.Date) bool {
	counts := n.brought
	if n.own != nil {
		counts = append([]*parentbilling.FamilyChildCount{n.own}, counts...)
	}
	for _, count := range counts {
		for _, confirmation := range confirmations(count) {
			if confirmation.ValidUntil != nil && confirmation.ValidUntil.Before(day) {
				return true
			}
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
