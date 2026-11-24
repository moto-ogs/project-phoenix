package application

import (
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
// The sibling chain groups the issued contracts of the month too (#7863);
// groupCare applies a join only where the chain sees every part as a child
// of its own and every invoice issued for a part froze the family of the
// change (careChain.aligned).
//
// A contract only an issued invoice brings into the month (withdrawn, or
// ended before it) is a part too (#7892): the child, family and school of
// its invoice stand for it, and it runs on no day of the month. So the child
// it billed and the child of the contract at the new school are one child
// for the sibling chain and for "already billed" (billedChildHolds).

// schoolChangeSource is what a school change reads of a contract: in force
// its versions and family, outside the versions in force the child, family
// and school of the issued invoice that names it.
type schoolChangeSource struct {
	byContract map[int64][]parentbilling.CareContractVersion
	families   map[int64]string
	outside    map[int64]outsideContract
}

// outsideContract is a contract only an issued invoice of the month names.
type outsideContract struct {
	child  parentbilling.CareContractChild
	family string
	place  parentbilling.CareDuplicateContract
}

// schoolsOf are the schools a contract lies at.
func (s schoolChangeSource) schoolsOf(contractID int64) []int64 {
	if outside, ok := s.outside[contractID]; ok {
		return []int64{outside.place.SchoolID.Int64()}
	}
	var schools []int64
	for _, version := range s.byContract[contractID] {
		schools = append(schools, version.SchoolID)
	}
	return schools
}

// meet tells whether two contracts lie at the same school or have versions
// in force on the same day. A contract outside the versions in force runs on
// no day of the month.
func (s schoolChangeSource) meet(left, right int64) bool {
	for _, school := range s.schoolsOf(left) {
		if slices.Contains(s.schoolsOf(right), school) {
			return true
		}
	}
	return versionsMeet(s.byContract[left], s.byContract[right])
}

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
		families[contractID] = recipients[contractID].FamilyOf(contractID)
	}
	return families
}

// joinSchoolChanges joins the children of E1 that are one child changing its
// school. The result keeps the places of E1: a joined child stands where its
// first part stood, and the places of its other parts stay empty, so every
// other child keeps its place. joined names the joined children by their
// place and parts the children each one joins; accept can refuse a join
// (careChain.accepts).
func joinSchoolChanges(children [][]int64, source schoolChangeSource, accept func(parts [][]int64) bool,
) (result [][]int64, joined []int, parts [][][]int64) {
	identities := make([]schoolChangePart, len(children))
	for i, child := range children {
		identities[i] = schoolChangePartOf(child, source)
	}
	result = children
	for _, bucket := range schoolChangeBuckets(identities) {
		joining := make([][]int64, len(bucket))
		for i, part := range bucket {
			joining[i] = children[part]
		}
		if !bucketJoins(bucket, identities, children, source) || !accept(joining) {
			continue
		}
		if joined == nil {
			result = slices.Clone(children)
		}
		first := bucket[0]
		result[first] = slices.Concat(joining...)
		for _, part := range bucket[1:] {
			result[part] = nil
		}
		joined = append(joined, first)
		parts = append(parts, joining)
	}
	return result, joined, parts
}

// schoolChangePartOf reads the names, dates of birth and families of the
// contracts in force of a child, and of the contracts only an issued invoice
// names.
func schoolChangePartOf(child []int64, source schoolChangeSource) schoolChangePart {
	part := schoolChangePart{complete: true}
	for _, contractID := range child {
		identity, family, known := source.identityOf(contractID)
		if !known {
			continue
		}
		person := schoolChangePerson{first: schoolChangeName(identity.FirstName), last: schoolChangeName(identity.LastName)}
		if identity.BirthDate != nil {
			person.birth = *identity.BirthDate
		} else {
			part.complete = false
		}
		part.recorded = part.recorded || identity.StudentID != nil
		if !slices.Contains(part.persons, person) {
			part.persons = append(part.persons, person)
		}
		if !slices.Contains(part.families, family) {
			part.families = append(part.families, family)
		}
	}
	return part
}

// identityOf is the child and the family of a contract: of its first
// version in force, else of the issued invoice that names it.
func (s schoolChangeSource) identityOf(contractID int64) (parentbilling.CareContractChild, string, bool) {
	if versions, inForce := s.byContract[contractID]; inForce {
		return childOfVersion(versions[0]), s.families[contractID], true
	}
	outside, ok := s.outside[contractID]
	return outside.child, outside.family, ok
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
func bucketJoins(bucket []int, parts []schoolChangePart, children [][]int64, source schoolChangeSource) bool {
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
	return oneAfterAnother(bucket, children, source)
}

// schoolChangeName spells a name so that two schools that wrote it
// differently still match: composed (a name pasted in decomposed form),
// umlauts written out and accents dropped (textnorm.ASCII), without case
// and with the spaces collapsed. It is not E1's normalizedName, which only
// ignores case; two spellings within one child stop a join, they never
// cause one.
func schoolChangeName(name string) string {
	return strings.Join(strings.Fields(strings.ToLower(textnorm.ASCII(name))), " ")
}

// oneAfterAnother tells whether the children lie at different schools and
// their contracts never run on the same day.
func oneAfterAnother(parts []int, children [][]int64, source schoolChangeSource) bool {
	for i, a := range parts {
		for _, b := range parts[i+1:] {
			if sharesSchoolOrDay(children[a], children[b], source) {
				return false
			}
		}
	}
	return true
}

// sharesSchoolOrDay tells whether two children have a contract at the same
// school or contracts that run on the same day.
func sharesSchoolOrDay(a, b []int64, source schoolChangeSource) bool {
	for _, left := range a {
		for _, right := range b {
			if source.meet(left, right) {
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
// contract and its school in the order they begin, for the review. A
// contract only an issued invoice names comes first: it runs before the
// month or not at all.
func joinedChildren(grouping careGrouping, source schoolChangeSource) []parentbilling.CareJoinedChild {
	shown := make([]parentbilling.CareJoinedChild, 0, len(grouping.joined))
	for _, i := range grouping.joined {
		var contracts []parentbilling.CareDuplicateContract
		inOrder := slices.Clone(grouping.joinedContracts[i])
		slices.SortStableFunc(inOrder, func(a, b int64) int {
			return firstNonZero(startOf(source.byContract[a]).Compare(startOf(source.byContract[b])), compareOrdered(a, b))
		})
		for _, contractID := range inOrder {
			if versions, inForce := source.byContract[contractID]; inForce {
				contracts = append(contracts, parentbilling.CareDuplicateContract{ContractID: ident.ID(contractID),
					SchoolID: ident.ID(versions[0].SchoolID), SchoolName: versions[0].SchoolName})
			} else if outside, ok := source.outside[contractID]; ok {
				contracts = append(contracts, outside.place)
			}
		}
		head := source.byContract[grouping.children[i][0]][0]
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

// issuedPlaces names the contract and school of every issued invoice that
// bills care for a contract outside the versions in force, as its invoice
// kept them. An invoice with only the Mensa and a notice month set to
// nothing bill no care: they take no part in a school change (#7892, S6).
func (in careMonthInput) issuedPlaces() map[int64]parentbilling.CareDuplicateContract {
	places := map[int64]parentbilling.CareDuplicateContract{}
	for id := range in.issuedChildIdentities() {
		invoice := in.invoiced[id]
		if len(invoice.Positions) == 0 {
			continue
		}
		places[id] = parentbilling.CareDuplicateContract{ContractID: ident.ID(id), SchoolID: invoice.SchoolID, SchoolName: invoice.SchoolName}
	}
	return places
}
