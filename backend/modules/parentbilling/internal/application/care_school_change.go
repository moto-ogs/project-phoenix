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
//   - every child of that name and date of birth, of any family, joins or
//     none does, and a child of that name without a date of birth stops
//     the join: one at the same school as another, at the same time, of
//     another family or with another spelling on one of its contracts leaves
//     all of them apart, whatever their order.
//
// Contracts outside the versions in force (issued invoices of the month,
// #7863) neither join nor stop a join; childKeys adds them afterwards.

// schoolChangePerson is a spelled name with its date of birth, empty
// without one.
type schoolChangePerson struct {
	first, last string
	birth       calendar.Date
}

// schoolChangePart is what a child of E1 brings to a school change: the
// spelled names with dates of birth of its contracts in force and their
// families. complete is false when one of them has no date of birth;
// recorded tells whether a contract names a record of the child.
type schoolChangePart struct {
	persons  []schoolChangePerson
	families []string
	complete bool
	recorded bool
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
	parts := make([]schoolChangePart, len(children))
	for i, child := range children {
		parts[i] = schoolChangePartOf(child, byContract, families)
	}
	into := map[int]int{}
	for _, bucket := range schoolChangeBuckets(parts) {
		if !bucketJoins(bucket, parts, children, byContract) {
			continue
		}
		for _, part := range bucket[1:] {
			into[part] = bucket[0]
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
	firsts := slices.Sorted(maps.Values(into))
	for i := range children {
		if _, found := slices.BinarySearch(firsts, i); found {
			joined = append(joined, at[i])
		}
	}
	return result, joined
}

// schoolChangePartOf reads the names, dates of birth and families of the
// contracts in force of a child.
func schoolChangePartOf(child []int64, byContract map[int64][]parentbilling.CareContractVersion, families map[int64]string) schoolChangePart {
	part := schoolChangePart{complete: true}
	for _, contractID := range child {
		versions, inForce := byContract[contractID]
		if !inForce {
			continue
		}
		head := versions[0]
		person := schoolChangePerson{first: schoolChangeName(head.ChildFirstName), last: schoolChangeName(head.ChildLastName)}
		if head.ChildBirthDate != nil {
			person.birth = *head.ChildBirthDate
		} else {
			part.complete = false
		}
		part.recorded = part.recorded || head.StudentID != nil
		if !slices.Contains(part.persons, person) {
			part.persons = append(part.persons, person)
		}
		if !slices.Contains(part.families, families[contractID]) {
			part.families = append(part.families, families[contractID])
		}
	}
	return part
}

// schoolChangeBuckets groups the children by name and date of birth, in
// the order of the children; a child with several goes into each. A child
// of a name without a date of birth goes into every bucket of that name,
// where it stops the join.
func schoolChangeBuckets(parts []schoolChangePart) [][]int {
	index := map[schoolChangePerson]int{}
	var buckets [][]int
	for i, part := range parts {
		for _, person := range part.persons {
			if birthless(person) {
				continue
			}
			at, seen := index[person]
			if !seen {
				at = len(buckets)
				index[person] = at
				buckets = append(buckets, nil)
			}
			buckets[at] = append(buckets[at], i)
		}
	}
	for i, part := range parts {
		for _, person := range part.persons {
			if birthless(person) {
				addToBucketsOfName(buckets, index, person, i)
			}
		}
	}
	return buckets
}

// birthless tells whether a spelled person carries no date of birth.
func birthless(person schoolChangePerson) bool { return person.birth == "" }

// addToBucketsOfName puts a child into every bucket of the name, once.
func addToBucketsOfName(buckets [][]int, index map[schoolChangePerson]int, name schoolChangePerson, child int) {
	for key, at := range index {
		if key.first == name.first && key.last == name.last && !slices.Contains(buckets[at], child) {
			buckets[at] = append(buckets[at], child)
		}
	}
}

// bucketJoins tells whether the children of a bucket are one child: each
// with a record (without one E1 already decides by the name), one name,
// one date of birth and one family, all the same family, at different
// schools and one after the other.
func bucketJoins(bucket []int, parts []schoolChangePart, children [][]int64, byContract map[int64][]parentbilling.CareContractVersion) bool {
	if len(bucket) < 2 {
		return false
	}
	family := parts[bucket[0]].families
	for _, i := range bucket {
		part := parts[i]
		if !part.recorded || !part.complete || len(part.persons) != 1 || len(part.families) != 1 || part.families[0] != family[0] {
			return false
		}
	}
	return oneAfterAnother(bucket, children, byContract)
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
