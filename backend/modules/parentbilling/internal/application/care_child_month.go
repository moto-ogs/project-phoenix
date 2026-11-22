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

// careGrouping is how one month (or span) groups its contracts by child
// (ADR 0158 E1): children over the contracts in force for the billed days
// (E2), the duplicates (E3) and the review, and keys over the contracts in
// force together with the contracts an issued invoice bills outside them for
// the sibling chain (#7863), each as before #7874. A child that changed its
// school with a record at each school is one child in both (joinSchoolChanges);
// joined names it by its place in children.
type careGrouping struct {
	children [][]int64
	keys     map[int64]string
	joined   []int
}

// groupCare groups the contracts of a month by child.
func groupCare(byContract map[int64][]parentbilling.CareContractVersion, order []int64, families map[int64]string,
	issued map[int64]parentbilling.CareContractChild,
) careGrouping {
	chain := chainChildren(byContract, order, issued)
	keys := chainKeys(byContract, chain)
	place := map[int64]int{}
	for i, child := range chain {
		for _, contractID := range child {
			place[contractID] = i
		}
	}
	// A part joins only where the chain sees it as one child of its own:
	// then both groupings change in the same way.
	aligned := func(part []int64) bool {
		inForce := 0
		for _, contractID := range chain[place[part[0]]] {
			if _, ok := byContract[contractID]; ok {
				inForce++
			}
		}
		return inForce == len(part) && !slices.ContainsFunc(part, func(contractID int64) bool { return place[contractID] != place[part[0]] })
	}
	children, joined := joinSchoolChanges(groupCareChildren(contractChildrenOf(byContract), order), byContract, families, aligned)
	for _, first := range joined {
		key := keys[children[first][0]]
		for _, contractID := range children[first] {
			for _, member := range chain[place[contractID]] {
				keys[member] = key
			}
		}
	}
	return careGrouping{children: children, keys: keys, joined: joined}
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
// (groupCare).
func childKeys(byContract map[int64][]parentbilling.CareContractVersion, order []int64, issued map[int64]parentbilling.CareContractChild,
	families map[int64]string,
) map[int64]string {
	return groupCare(byContract, order, families, issued).keys
}

// chainChildren groups the contracts in force and any issued contracts with
// retained identities together (ADR 0158 E1). Issued contracts outside the
// month only take part in the sibling chain, not the billed days (E2).
func chainChildren(byContract map[int64][]parentbilling.CareContractVersion, order []int64,
	issued map[int64]parentbilling.CareContractChild,
) [][]int64 {
	identities := contractChildrenOf(byContract)
	order = slices.Clone(order)
	for _, id := range slices.Sorted(maps.Keys(issued)) {
		if _, inForce := identities[id]; !inForce {
			identities[id] = issued[id]
			order = append(order, id)
		}
	}
	return groupCareChildren(identities, order)
}

// chainKeys names the children of the chain by their place, a child only
// issued contracts bill by its first contract.
func chainKeys(byContract map[int64][]parentbilling.CareContractVersion, chain [][]int64) map[int64]string {
	keys := map[int64]string{}
	for i, child := range chain {
		key := "child:" + strconv.Itoa(i)
		if _, inForce := byContract[child[0]]; !inForce {
			key = "contract:" + strconv.FormatInt(child[0], 10)
		}
		for _, contractID := range child {
			keys[contractID] = key
		}
	}
	return keys
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
