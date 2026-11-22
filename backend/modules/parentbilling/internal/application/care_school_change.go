package application

import (
	"maps"
	"slices"
	"strings"

	"github.com/moto-ogs/project-phoenix/modules/parentbilling"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
	"github.com/moto-ogs/project-phoenix/sharedkernel/textnorm"
)

// A child that changes its school may have a record at each school (ADR
// 0158, Nachtrag Schulwechsel, #7874). A record belongs to one school, so
// E1 sees two children. joinSchoolChanges joins them when nothing else can
// be meant:
//
//   - the contracts name the same family (ContractFamilyKey, a mail
//     address), the same name as schoolChangeName spells it and the same
//     date of birth; without a mail address or a date of birth nothing joins;
//   - the children lie at different schools: within one school the record
//     decides, as before;
//   - their contracts run one after the other: no day of the read span on
//     which contracts of two of them both run. Twins of one name at two
//     schools have contracts at the same time and stay two children;
//   - all children of one family, name and date of birth join or none: one
//     at the same school as another, or at the same time, leaves all of
//     them apart, whatever their order.
//
// Contracts outside the versions in force (issued invoices of the month,
// #7863) neither join nor stop a join; they stay with the child of their
// record (E1).

// schoolChangeKey is the family, the spelled name and the date of birth of
// a child that may have changed its school.
type schoolChangeKey struct {
	family, person string
}

// contractFamilies is the family of every contract in force: the mail
// address of the recipient of its invoice, else the contract itself.
func contractFamilies(byContract map[int64][]parentbilling.CareContractVersion, recipients map[int64]parentbilling.CareRecipient) map[int64]string {
	families := make(map[int64]string, len(byContract))
	for contractID := range byContract {
		families[contractID] = parentbilling.ContractFamilyKey(recipients[contractID].Email, contractID)
	}
	return families
}

// joinSchoolChanges joins the children of E1 that are one child changing its
// school, in the order of the children: a joined child stands where its
// first part stood. joined names the joined children by their index in
// the result.
func joinSchoolChanges(children [][]int64, byContract map[int64][]parentbilling.CareContractVersion, families map[int64]string) (result [][]int64, joined []int) {
	into := map[int]int{}
	for _, parts := range schoolChangeBuckets(children, byContract, families) {
		if len(parts) < 2 || !oneAfterAnother(parts, children, byContract) {
			continue
		}
		for _, part := range parts[1:] {
			into[part] = parts[0]
		}
	}
	if len(into) == 0 {
		return children, nil
	}
	at := map[int]int{}
	for i, child := range children {
		if first, ok := into[i]; ok {
			result[at[first]] = append(result[at[first]], child...)
			continue
		}
		at[i] = len(result)
		result = append(result, slices.Clone(child))
	}
	for i := range children {
		if _, part := into[i]; !part && slices.Contains(slices.Collect(maps.Values(into)), i) {
			joined = append(joined, at[i])
		}
	}
	return result, joined
}

// schoolChangeBuckets groups the children that may join by their key, in
// the order of the children; a child that may join none is left out.
func schoolChangeBuckets(children [][]int64, byContract map[int64][]parentbilling.CareContractVersion, families map[int64]string) [][]int {
	index := map[schoolChangeKey]int{}
	var buckets [][]int
	for i, child := range children {
		key, ok := schoolChangeKeyOf(child, byContract, families)
		if !ok {
			continue
		}
		at, seen := index[key]
		if !seen {
			at = len(buckets)
			index[key] = at
			buckets = append(buckets, nil)
		}
		buckets[at] = append(buckets[at], i)
	}
	return buckets
}

// schoolChangeKeyOf is the key a child may join others under; ok is false
// for a child without a contract in force, with two families, two names or
// no date of birth, or of a family moto knows only by its contract.
func schoolChangeKeyOf(child []int64, byContract map[int64][]parentbilling.CareContractVersion, families map[int64]string) (schoolChangeKey, bool) {
	var key schoolChangeKey
	for _, contractID := range child {
		versions, inForce := byContract[contractID]
		if !inForce {
			continue
		}
		head := versions[0]
		if head.ChildBirthDate == nil || parentbilling.IsContractFamily(families[contractID]) {
			return schoolChangeKey{}, false
		}
		own := schoolChangeKey{family: families[contractID],
			person: schoolChangeName(head.ChildFirstName) + "|" + schoolChangeName(head.ChildLastName) + "|" + head.ChildBirthDate.String()}
		if key != (schoolChangeKey{}) && key != own {
			return schoolChangeKey{}, false
		}
		key = own
	}
	return key, key != (schoolChangeKey{}) && key.family != ""
}

// schoolChangeName spells a name so that two schools that wrote it
// differently still match: composed (a name pasted in decomposed form),
// umlauts written out and accents dropped (textnorm.ASCII), without case
// and with the spaces collapsed.
func schoolChangeName(name string) string {
	return strings.Join(strings.Fields(strings.ToLower(textnorm.ASCII(name))), " ")
}

// oneAfterAnother tells whether the children lie at different schools and
// their contracts never run on the same day.
func oneAfterAnother(parts []int, children [][]int64, byContract map[int64][]parentbilling.CareContractVersion) bool {
	for i, a := range parts {
		for _, b := range parts[i+1:] {
			if sharesSchoolOrDay(children[a], children[b], byContract) {
				return false
			}
		}
	}
	return true
}

// sharesSchoolOrDay tells whether two children have a contract at the same
// school or contracts that run on the same day.
func sharesSchoolOrDay(a, b []int64, byContract map[int64][]parentbilling.CareContractVersion) bool {
	for _, left := range a {
		for _, right := range b {
			if versionsMeet(byContract[left], byContract[right]) {
				return true
			}
		}
	}
	return false
}

// versionsMeet tells whether two contracts lie at the same school or have
// versions in force on the same day.
func versionsMeet(left, right []parentbilling.CareContractVersion) bool {
	for _, l := range left {
		for _, r := range right {
			if l.SchoolID == r.SchoolID || (!l.From.After(r.Until) && !r.From.After(l.Until)) {
				return true
			}
		}
	}
	return false
}

// joinedChildren names the children joinSchoolChanges joined, with every
// contract and its school in the order they begin, for the review.
func joinedChildren(children [][]int64, joined []int, byContract map[int64][]parentbilling.CareContractVersion) []parentbilling.CareJoinedChild {
	shown := make([]parentbilling.CareJoinedChild, 0, len(joined))
	for _, i := range joined {
		var contracts []parentbilling.CareDuplicateContract
		inOrder := slices.Clone(children[i])
		slices.SortStableFunc(inOrder, func(a, b int64) int {
			return firstNonZero(startOf(byContract[a]).Compare(startOf(byContract[b])), compareOrdered(a, b))
		})
		for _, contractID := range inOrder {
			if versions, inForce := byContract[contractID]; inForce {
				contracts = append(contracts, parentbilling.CareDuplicateContract{ContractID: ident.ID(contractID),
					SchoolID: ident.ID(versions[0].SchoolID), SchoolName: versions[0].SchoolName})
			}
		}
		head := byContract[children[i][0]][0]
		shown = append(shown, parentbilling.CareJoinedChild{ChildFirstName: head.ChildFirstName, ChildLastName: head.ChildLastName,
			Contracts: contracts})
	}
	return shown
}

// startOf is the first day of a contract in force, empty for one outside
// the versions in force.
func startOf(versions []parentbilling.CareContractVersion) calendar.Date {
	if len(versions) == 0 {
		return ""
	}
	return versions[0].From
}
