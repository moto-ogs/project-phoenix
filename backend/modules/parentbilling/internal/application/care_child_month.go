package application

import (
	"fmt"
	"maps"
	"slices"
	"strconv"
	"strings"

	"github.com/moto-ogs/project-phoenix/modules/parentbilling"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

// The billing unit child-month (ADR 0158, Nachtrag Kind-Monat): the monthly
// run bills each child once a month. childMonthHolds decides which children
// it holds back for a duplicate contract (E1 to E4); holdSnapshot is what a
// release stores of them and holdView what a released run shows (E5). Both are pure: they read only their
// arguments.

// childMonthHolds groups the contracts of the month by child (E1), lays
// down the days every contract bills under the rule (E2) and finds a
// duplicate where two contracts of a child bill the same module on the
// same calendar day (E3). A child with a duplicate is held with all its
// contracts (E4). It returns one entry per doubly billed module and
// weekday, each naming every contract of its child, and the held contracts.
func childMonthHolds(month calendar.Date, rule string, byContract map[int64][]parentbilling.CareContractVersion, children [][]int64,
	entries map[int64]bool,
) ([]parentbilling.CareDuplicate, map[int64]bool) {
	duplicates := []parentbilling.CareDuplicate{}
	held := map[int64]bool{}
	for _, child := range children {
		doubled := doublyBilled(month, rule, child, byContract, entries)
		if len(doubled) == 0 {
			continue
		}
		contracts := childContracts(child, byContract)
		head := byContract[child[0]][0]
		for _, slot := range doubled {
			duplicates = append(duplicates, parentbilling.CareDuplicate{
				ChildFirstName: head.ChildFirstName, ChildLastName: head.ChildLastName,
				ModuleName: slot.name, Weekday: slot.weekday, Contracts: contracts,
			})
		}
		for _, contractID := range child {
			held[contractID] = true
		}
	}
	return duplicates, held
}

// holdSnapshot is what a release stores of the children it holds back
// (E5): per child, in the order of the run, its name, every contract with
// its school and the modules and weekdays billed twice.
func holdSnapshot(duplicates []parentbilling.CareDuplicate) []parentbilling.CareRunHold {
	holds := []parentbilling.CareRunHold{}
	index := map[int64]int{}
	for _, duplicate := range duplicates {
		key := duplicate.Contracts[0].ContractID
		i, seen := index[key.Int64()]
		if !seen {
			i = len(holds)
			index[key.Int64()] = i
			holds = append(holds, parentbilling.CareRunHold{
				Position: i + 1, Reason: parentbilling.HoldReasonDuplicateContract,
				ChildFirstName: duplicate.ChildFirstName, ChildLastName: duplicate.ChildLastName,
				Contracts: slices.Clone(duplicate.Contracts), Slots: []parentbilling.CareHeldSlot{},
			})
		}
		holds[i].Slots = append(holds[i].Slots, parentbilling.CareHeldSlot{ModuleName: duplicate.ModuleName, Weekday: duplicate.Weekday})
	}
	return holds
}

// holdView is what a released run shows of the children it held back: the
// stored snapshot and nothing else (E5), one entry per module and weekday
// billed twice, as the preview showed it at the release.
func holdView(holds []parentbilling.CareRunHold) []parentbilling.CareDuplicate {
	shown := []parentbilling.CareDuplicate{}
	for _, hold := range holds {
		for _, slot := range hold.Slots {
			shown = append(shown, parentbilling.CareDuplicate{
				ChildFirstName: hold.ChildFirstName, ChildLastName: hold.ChildLastName,
				ModuleName: slot.ModuleName, Weekday: slot.Weekday, Contracts: slices.Clone(hold.Contracts),
			})
		}
	}
	return shown
}

// childrenOf groups the contracts by child (E1), in the order of the
// contracts: by the child record, without one by the normalized name and
// date of birth. A contract without a record joins the child whose record's
// contracts carry the same name and date of birth when exactly one does.
// Records at two schools of a child that changed its school are one child
// (joinSchoolChanges).
func childrenOf(byContract map[int64][]parentbilling.CareContractVersion, order []int64, families map[int64]string) [][]int64 {
	children, _ := joinSchoolChanges(groupCareChildren(contractChildrenOf(byContract), order), byContract, families)
	return children
}

func contractChildrenOf(byContract map[int64][]parentbilling.CareContractVersion) map[int64]parentbilling.CareContractChild {
	children := make(map[int64]parentbilling.CareContractChild, len(byContract))
	for contractID, versions := range byContract {
		children[contractID] = childOfVersion(versions[0])
	}
	return children
}

// childOfVersion is the identity of the child a version names.
func childOfVersion(version parentbilling.CareContractVersion) parentbilling.CareContractChild {
	return parentbilling.CareContractChild{StudentID: version.StudentID, FirstName: version.ChildFirstName,
		LastName: version.ChildLastName, BirthDate: version.ChildBirthDate}
}

func groupCareChildren(identities map[int64]parentbilling.CareContractChild, order []int64) [][]int64 {
	recordsOf := map[string][]int64{}
	for _, contractID := range order {
		child := identities[contractID]
		person := personOf(child)
		if child.StudentID != nil && !slices.Contains(recordsOf[person], *child.StudentID) {
			recordsOf[person] = append(recordsOf[person], *child.StudentID)
		}
	}
	groups := map[string][]int64{}
	var keys []string
	for _, contractID := range order {
		key := childKeyOf(identities[contractID], recordsOf)
		if _, seen := groups[key]; !seen {
			keys = append(keys, key)
		}
		groups[key] = append(groups[key], contractID)
	}
	children := make([][]int64, len(keys))
	for i, key := range keys {
		children[i] = groups[key]
	}
	return children
}

// childKeys names per contract the child the sibling chain counts it as
// (ADR 0158 E1): the contracts in force grouped as E2 and E3 group them
// (childrenOf), then the contracts an issued invoice of the month bills
// outside the versions in force (#7863). Those join the child that carries
// their record, or without a record the one child whose records carry
// their name and date of birth; they never regroup the contracts in force.
// A key depends only on the contracts of its own child, so a change in one
// family does not reorder the children of another.
func childKeys(byContract map[int64][]parentbilling.CareContractVersion, children [][]int64, issued map[int64]parentbilling.CareContractChild) map[int64]string {
	keys := map[int64]string{}
	byRecord := map[int64]string{}
	byPerson := map[string][]string{}
	personless := map[string][]string{}
	for i, child := range children {
		key := "child:" + strconv.Itoa(i)
		for _, contractID := range child {
			keys[contractID] = key
			identity := childOfVersion(byContract[contractID][0])
			addRecordKey(byRecord, byPerson, identity, key)
			if person := personOf(identity); identity.StudentID == nil && !slices.Contains(personless[person], key) {
				personless[person] = append(personless[person], key)
			}
		}
	}
	attachIssued(keys, childIndex{byRecord: byRecord, byPerson: byPerson, personless: personless}, byContract, issued)
	return keys
}

// childIndex finds the child of a contract by its record or by the name
// and date of birth its records or its contracts without a record carry.
type childIndex struct {
	byRecord   map[int64]string
	byPerson   map[string][]string
	personless map[string][]string
}

// attachIssued keys the contracts an issued invoice bills outside the
// versions in force as E1 would group them with the contracts in force,
// without regrouping those: a record known in force keeps its child and
// lends it the name the issued contract spells; a new record joins the
// one child in force without a record of its name and date of birth when
// no other record carries them; a contract without a record goes by
// unrecordedKey.
func attachIssued(keys map[int64]string, index childIndex, byContract map[int64][]parentbilling.CareContractVersion,
	issued map[int64]parentbilling.CareContractChild,
) {
	recorded, unrecorded := outsideInForce(byContract, issued)
	records := recordsByPerson(byContract, issued, recorded)
	byRecord := map[int64][]int64{}
	var order []int64
	for _, contractID := range recorded {
		record := *issued[contractID].StudentID
		if _, seen := byRecord[record]; !seen {
			order = append(order, record)
		}
		byRecord[record] = append(byRecord[record], contractID)
	}
	for _, record := range order {
		key, known := index.byRecord[record]
		if !known {
			key = newRecordKey(record, byRecord[record], issued, records, index.personless)
		}
		for _, contractID := range byRecord[record] {
			addRecordKey(index.byRecord, index.byPerson, issued[contractID], key)
			keys[contractID] = key
		}
	}
	for _, contractID := range unrecorded {
		keys[contractID] = unrecordedKey(personOf(issued[contractID]), index.byPerson, index.personless)
	}
	keyIssuedChildren(keys, issued, byContract)
}

// keyIssuedChildren names a child only issued contracts bill by its first
// contract, as E1 did (#7863): "contract:" and the smallest of them.
func keyIssuedChildren(keys map[int64]string, issued map[int64]parentbilling.CareContractChild,
	byContract map[int64][]parentbilling.CareContractVersion,
) {
	first := map[string]int64{}
	for _, contractID := range slices.Sorted(maps.Keys(issued)) {
		if _, inForce := byContract[contractID]; inForce || strings.HasPrefix(keys[contractID], "child:") {
			continue
		}
		if _, seen := first[keys[contractID]]; !seen {
			first[keys[contractID]] = contractID
		}
	}
	for contractID, key := range keys {
		if id, issuedOnly := first[key]; issuedOnly {
			keys[contractID] = "contract:" + strconv.FormatInt(id, 10)
		}
	}
}

// outsideInForce splits the issued contracts outside the versions in force
// into those with a record and those without, each sorted.
func outsideInForce(byContract map[int64][]parentbilling.CareContractVersion, issued map[int64]parentbilling.CareContractChild) (recorded, unrecorded []int64) {
	for _, contractID := range slices.Sorted(maps.Keys(issued)) {
		if _, inForce := byContract[contractID]; inForce {
			continue
		}
		if issued[contractID].StudentID == nil {
			unrecorded = append(unrecorded, contractID)
		} else {
			recorded = append(recorded, contractID)
		}
	}
	return recorded, unrecorded
}

// recordsByPerson names per name and date of birth the records the
// contracts in force and the issued contracts with a record carry.
func recordsByPerson(byContract map[int64][]parentbilling.CareContractVersion, issued map[int64]parentbilling.CareContractChild,
	recorded []int64,
) map[string][]int64 {
	records := map[string][]int64{}
	note := func(child parentbilling.CareContractChild) {
		if person := personOf(child); child.StudentID != nil && !slices.Contains(records[person], *child.StudentID) {
			records[person] = append(records[person], *child.StudentID)
		}
	}
	for _, versions := range byContract {
		note(childOfVersion(versions[0]))
	}
	for _, contractID := range recorded {
		note(issued[contractID])
	}
	return records
}

// newRecordKey is the child of the issued contracts of a record no contract
// in force names: the one child in force without a record that one of
// their spellings names, when the record is the only one of that name and
// date of birth (E1), else the record's own.
func newRecordKey(record int64, contracts []int64, issued map[int64]parentbilling.CareContractChild, records map[string][]int64,
	personless map[string][]string,
) string {
	var found []string
	for _, contractID := range contracts {
		person := personOf(issued[contractID])
		if candidates := personless[person]; len(records[person]) == 1 && len(candidates) == 1 && !slices.Contains(found, candidates[0]) {
			found = append(found, candidates[0])
		}
	}
	if len(found) == 1 {
		return found[0]
	}
	return fmt.Sprintf("student:%d", record)
}

// unrecordedKey is the child of a contract without a record (E1): the one
// child whose records carry its name and date of birth, else the child of
// the contracts in force without a record of that name and date of birth,
// else that name and date of birth.
func unrecordedKey(person string, byPerson, personless map[string][]string) string {
	if found := byPerson[person]; len(found) == 1 {
		return found[0]
	}
	if found := personless[person]; len(found) == 1 {
		return found[0]
	}
	return "person:" + person
}

// addRecordKey notes the key of a child under its record and under the
// name and date of birth its record carries.
func addRecordKey(byRecord map[int64]string, byPerson map[string][]string, child parentbilling.CareContractChild, key string) {
	if child.StudentID == nil {
		return
	}
	byRecord[*child.StudentID] = key
	if person := personOf(child); !slices.Contains(byPerson[person], key) {
		byPerson[person] = append(byPerson[person], key)
	}
}

// childKeyOf is the child a contract bills: its record, the one record
// with its name and date of birth, else that name and date of birth.
func childKeyOf(child parentbilling.CareContractChild, recordsOf map[string][]int64) string {
	if child.StudentID != nil {
		return fmt.Sprintf("student:%d", *child.StudentID)
	}
	person := personOf(child)
	if records := recordsOf[person]; len(records) == 1 {
		return fmt.Sprintf("student:%d", records[0])
	}
	return "person:" + person
}

// personOf is the normalized name and date of birth of the child of a
// contract.
func personOf(child parentbilling.CareContractChild) string {
	birth := ""
	if child.BirthDate != nil {
		birth = child.BirthDate.String()
	}
	return normalizedName(child.FirstName) + "|" + normalizedName(child.LastName) + "|" + birth
}

func normalizedName(name string) string {
	return strings.Join(strings.Fields(strings.ToLower(name)), " ")
}

// slotKey is one module on one calendar day of the month.
type slotKey struct {
	offeringID int64
	day        calendar.Date
}

// doubledSlot is a module and weekday two contracts of a child both bill.
type doubledSlot struct {
	offeringID int64
	name       string
	weekday    string
}

// doublyBilled lists, in the order of the days, every module and weekday
// that two contracts of the child bill on the same calendar day (E3), each
// once.
func doublyBilled(month calendar.Date, rule string, child []int64, byContract map[int64][]parentbilling.CareContractVersion, entries map[int64]bool) []doubledSlot {
	billers := map[slotKey]int{}
	names := map[int64]string{}
	for _, contractID := range child {
		for slot, name := range billedSlots(month, rule, byContract[contractID], entries[contractID]) {
			billers[slot]++
			names[slot.offeringID] = name
		}
	}
	var doubled []doubledSlot
	for day := month; !day.After(monthEnd(month)); day = day.AddDays(1) {
		for offeringID, name := range names {
			slot := doubledSlot{offeringID: offeringID, name: name, weekday: weekdayOf(day)}
			if billers[slotKey{offeringID, day}] >= 2 && !slices.Contains(doubled, slot) {
				doubled = append(doubled, slot)
			}
		}
	}
	slices.SortStableFunc(doubled, func(a, b doubledSlot) int {
		return firstNonZero(compareOrdered(a.name, b.name), compareOrdered(a.offeringID, b.offeringID),
			compareOrdered(weekdayOrder[a.weekday], weekdayOrder[b.weekday]))
	})
	return doubled
}

// billedSlots are the calendar days a contract bills each module on under
// the rule (E2): the tracks of the month, the same ones its invoice bills.
func billedSlots(month calendar.Date, rule string, versions []parentbilling.CareContractVersion, entry bool) map[slotKey]string {
	slots := map[slotKey]string{}
	for _, track := range tracksOf(month, rule, versions, entry) {
		for _, run := range track.runs {
			for day := run.from; !day.After(run.until); day = day.AddDays(1) {
				if slices.Contains(run.weekdays, weekdayOf(day)) {
					slots[slotKey{track.offeringID, day}] = track.name
				}
			}
		}
	}
	return slots
}

// monthEntries names, per child without a contract in force on the first
// of the month, the first contract that begins in the month (E2 under the
// full month): it bills the whole month by its first version. Any further
// contract that begins later bills nothing that month, and a child with a
// contract on the first has no entry. On the same start day the earlier
// contract of the order is the entry.
func monthEntries(month calendar.Date, byContract map[int64][]parentbilling.CareContractVersion, children [][]int64) map[int64]bool {
	entries := map[int64]bool{}
	for _, child := range children {
		entry := int64(0)
		for _, contractID := range child {
			versions := byContract[contractID]
			if _, onFirst := versionOn(versions, month); onFirst {
				entry = 0
				break
			}
			if entry == 0 || versions[0].From.Before(byContract[entry][0].From) {
				entry = contractID
			}
		}
		if entry != 0 {
			entries[entry] = true
		}
	}
	return entries
}

// childContracts names every contract of a child with its school.
func childContracts(child []int64, byContract map[int64][]parentbilling.CareContractVersion) []parentbilling.CareDuplicateContract {
	contracts := make([]parentbilling.CareDuplicateContract, len(child))
	for i, contractID := range child {
		head := byContract[contractID][0]
		contracts[i] = parentbilling.CareDuplicateContract{ContractID: ident.ID(contractID), SchoolID: ident.ID(head.SchoolID), SchoolName: head.SchoolName}
	}
	return contracts
}
