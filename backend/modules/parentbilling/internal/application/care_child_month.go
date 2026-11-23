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

// releaseSnapshot is everything a release stores of the children it holds
// back: those with a duplicate contract (holdSnapshot), then those an issued
// invoice already bills, each with the invoices in its way (#7892).
func releaseSnapshot(duplicates []parentbilling.CareDuplicate, billed []parentbilling.CareBilledChild) []parentbilling.CareRunHold {
	holds := holdSnapshot(duplicates)
	for _, child := range billed {
		holds = append(holds, parentbilling.CareRunHold{
			Position: len(holds) + 1, Reason: child.Reason, ChildFirstName: child.ChildFirstName, ChildLastName: child.ChildLastName,
			Contracts: slices.Clone(child.Contracts), Slots: []parentbilling.CareHeldSlot{}, Invoices: slices.Clone(child.Invoices),
		})
	}
	return holds
}

// billedHoldView is what a released run shows of the children it held back
// for an issued invoice: the stored snapshot and nothing else (E5).
func billedHoldView(holds []parentbilling.CareRunHold) []parentbilling.CareBilledChild {
	shown := []parentbilling.CareBilledChild{}
	for _, hold := range holds {
		if hold.Reason != parentbilling.HoldReasonAlreadyBilled && hold.Reason != parentbilling.HoldReasonMealOnlyInvoice {
			continue
		}
		shown = append(shown, parentbilling.CareBilledChild{ChildFirstName: hold.ChildFirstName, ChildLastName: hold.ChildLastName,
			Reason: hold.Reason, Contracts: slices.Clone(hold.Contracts), Invoices: append([]parentbilling.CareBilledInvoice{}, hold.Invoices...)})
	}
	return shown
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
// joined names it by its place in children and joinedContracts every contract
// of it, those only an issued invoice names included (#7892).
type careGrouping struct {
	children        [][]int64
	keys            map[int64]string
	joined          []int
	joinedContracts map[int][]int64
}

// groupCare groups the contracts of a month by child. issuedFamilies are
// the families the issued invoices of the month froze, by contract. No
// contract outside the versions in force takes part in a school change.
func groupCare(byContract map[int64][]parentbilling.CareContractVersion, order []int64, families map[int64]string,
	issued map[int64]parentbilling.CareContractChild, issuedFamilies map[int64]string,
) careGrouping {
	return groupCareMonth(byContract, order, families, issued, issuedFamilies, nil)
}

// groupCareMonth is groupCare with the schools of the issued invoices of
// contracts outside the versions in force (places): such a contract of a
// child that changed its school joins the child's contract in force (#7892).
func groupCareMonth(byContract map[int64][]parentbilling.CareContractVersion, order []int64, families map[int64]string,
	issued map[int64]parentbilling.CareContractChild, issuedFamilies map[int64]string, places map[int64]parentbilling.CareDuplicateContract,
) careGrouping {
	chain := newCareChain(byContract, order, issued, families, issuedFamilies)
	return chain.group(order, chain.schoolChangeSource(places))
}

// group joins the school changes of the chain and answers both groupings.
func (c careChain) group(order []int64, source schoolChangeSource) careGrouping {
	inForce := groupCareChildren(contractChildrenOf(c.byContract), order, nil)
	// The children only an issued invoice names follow the children in
	// force, so those keep their places.
	candidates := append(slices.Clone(inForce), c.outsideChildren(source)...)
	all, joined, parts := joinSchoolChanges(candidates, source, c.accepts)
	grouping := careGrouping{children: make([][]int64, len(inForce)), keys: c.keys, joinedContracts: map[int][]int64{}}
	for i := range inForce {
		// The place of a part that joined another child stays empty.
		grouping.children[i] = slices.DeleteFunc(slices.Clone(all[i]), func(contractID int64) bool {
			_, inForce := c.byContract[contractID]
			return !inForce
		})
	}
	for i, joining := range parts {
		c.join(joining)
		if joined[i] < len(inForce) {
			grouping.joined = append(grouping.joined, joined[i])
			grouping.joinedContracts[joined[i]] = all[joined[i]]
		}
	}
	slices.Sort(grouping.joined)
	return grouping
}

// careChain is the grouping of the sibling chain (chainChildren) with its
// keys and the place of every contract in it.
type careChain struct {
	byContract     map[int64][]parentbilling.CareContractVersion
	children       [][]int64
	keys           map[int64]string
	place          map[int64]int
	families       map[int64]string
	issuedFamilies map[int64]string
	// identities are the children the contracts in force and the issued ones
	// name.
	identities map[int64]parentbilling.CareContractChild
}

func newCareChain(byContract map[int64][]parentbilling.CareContractVersion, order []int64, issued map[int64]parentbilling.CareContractChild,
	families, issuedFamilies map[int64]string,
) careChain {
	children := chainChildren(byContract, order, issued)
	place := map[int64]int{}
	for i, child := range children {
		for _, contractID := range child {
			place[contractID] = i
		}
	}
	identities := contractChildrenOf(byContract)
	for contractID, child := range issued {
		if _, inForce := identities[contractID]; !inForce {
			identities[contractID] = child
		}
	}
	return careChain{byContract: byContract, children: children, keys: chainKeys(byContract, children), place: place,
		families: families, issuedFamilies: issuedFamilies, identities: identities}
}

// schoolChangeSource is what a school change reads of the contracts of the
// chain. A contract outside the versions in force takes part with the child
// and the family of its issued invoice, when places names its school.
func (c careChain) schoolChangeSource(places map[int64]parentbilling.CareDuplicateContract) schoolChangeSource {
	source := schoolChangeSource{byContract: c.byContract, families: c.families, outside: map[int64]outsideContract{}}
	for contractID, place := range places {
		if _, inForce := c.byContract[contractID]; inForce || place.SchoolID == 0 {
			continue
		}
		if family, issued := c.issuedFamilies[contractID]; issued {
			source.outside[contractID] = outsideContract{child: c.identities[contractID], family: family, place: place}
		}
	}
	return source
}

// outsideChildren are the children of the chain no contract in force names,
// each with the school of its invoices known: the candidates of a school
// change beside the children in force.
func (c careChain) outsideChildren(source schoolChangeSource) [][]int64 {
	var children [][]int64
	for _, child := range c.children {
		outside := !slices.ContainsFunc(child, func(contractID int64) bool {
			_, known := source.outside[contractID]
			return !known
		})
		if outside {
			children = append(children, child)
		}
	}
	return children
}

// familyOf is the family of a contract: of its recipient in force, else the
// one its issued invoice froze.
func (c careChain) familyOf(contractID int64) string {
	if _, inForce := c.byContract[contractID]; inForce {
		return c.families[contractID]
	}
	return c.issuedFamilies[contractID]
}

// accepts tells whether a school change joins: the chain sees every part
// as a child of its own, every invoice issued for a part froze the family of
// the change, at most one part has an issued invoice, and the family has no
// other child born on the same day. Then both groupings change in the same
// way, and no entry changes its rank against another: the chain breaks a tie
// of price and date of birth by the key, and only a twin could tie.
func (c careChain) accepts(parts [][]int64) bool {
	if c.hasTwin(parts) {
		return false
	}
	issuedParts := 0
	for _, part := range parts {
		aligned, issued := c.aligned(part)
		if !aligned {
			return false
		}
		if issued {
			issuedParts++
		}
	}
	return issuedParts <= 1
}

// hasTwin tells whether the family of a school change has another child
// of the chain born on the day of the joining child, or the joining child
// carries more than one date of birth. The chain fills a missing date of
// birth from any contract or issued entry of the same child
// (knownBirthDates, shareBirthDates) and ranks an issued entry under its
// frozen family (familyOf): a child counts as a twin when any of its
// contracts belongs to the family and any of them names the day, and the
// joining child is ranked by any date its parts name.
func (c careChain) hasTwin(parts [][]int64) bool {
	joining := map[int]bool{}
	var births []calendar.Date
	for _, part := range parts {
		place := c.place[part[0]]
		joining[place] = true
		births = c.birthsOf(c.children[place], births)
	}
	if len(births) != 1 {
		return true
	}
	family := c.familyOf(parts[0][0])
	for place, child := range c.children {
		if !joining[place] && c.inFamily(child, family) && slices.Contains(c.birthsOf(child, nil), births[0]) {
			return true
		}
	}
	return false
}

// inFamily tells whether a contract of a chain child belongs to the family,
// now or by an issued invoice.
func (c careChain) inFamily(child []int64, family string) bool {
	return slices.ContainsFunc(child, func(contractID int64) bool {
		return c.families[contractID] == family || c.issuedFamilies[contractID] == family
	})
}

// birthsOf adds the dates of birth the contracts and issued entries of a
// chain child name, each once.
func (c careChain) birthsOf(child []int64, births []calendar.Date) []calendar.Date {
	add := func(born *calendar.Date) {
		if born != nil && !slices.Contains(births, *born) {
			births = append(births, *born)
		}
	}
	for _, contractID := range child {
		add(c.identities[contractID].BirthDate)
		for _, version := range c.byContract[contractID] {
			add(version.ChildBirthDate)
		}
	}
	return births
}

// aligned tells whether the chain sees a part as one child of its own whose
// issued invoices all froze its family; issued tells whether it has one. A
// part is the contracts in force of a child, or a child only issued invoices
// name with all its contracts (#7892).
func (c careChain) aligned(part []int64) (aligned, issued bool) {
	group := c.children[c.place[part[0]]]
	family := c.familyOf(part[0])
	inForce := 0
	for _, contractID := range group {
		if _, ok := c.byContract[contractID]; ok {
			inForce++
		}
		if frozen, ok := c.issuedFamilies[contractID]; ok {
			if frozen != family {
				return false, true
			}
			issued = true
		}
	}
	partInForce := 0
	for _, contractID := range part {
		if _, ok := c.byContract[contractID]; ok {
			partInForce++
		}
	}
	whole := partInForce == len(part) || len(group) == len(part)
	return whole && inForce == partInForce && !slices.ContainsFunc(part, func(contractID int64) bool { return c.place[contractID] != c.place[part[0]] }), issued
}

// join gives the chain groups of the parts of a joined child one key: that
// of the part with an issued invoice, else that of the first part.
func (c careChain) join(parts [][]int64) {
	key := c.keys[parts[0][0]]
	for _, part := range parts {
		if _, issued := c.aligned(part); issued {
			key = c.keys[part[0]]
		}
	}
	for _, part := range parts {
		for _, member := range c.children[c.place[part[0]]] {
			c.keys[member] = key
		}
	}
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

// groupCareChildren groups the contracts by child. An issued contract
// outside the month lends its record to contracts without one only with a
// date of birth: it never claims another child by name alone (#7863).
func groupCareChildren(identities map[int64]parentbilling.CareContractChild, order []int64, issued map[int64]bool) [][]int64 {
	recordsOf := map[string][]int64{}
	for _, contractID := range order {
		child := identities[contractID]
		person := personOf(child)
		if child.StudentID != nil && (!issued[contractID] || child.BirthDate != nil) && !slices.Contains(recordsOf[person], *child.StudentID) {
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
	return groupCare(byContract, order, families, issued, nil).keys
}

// chainChildren groups the contracts in force and any issued contracts with
// retained identities together (ADR 0158 E1). Issued contracts outside the
// month only take part in the sibling chain, not the billed days (E2).
func chainChildren(byContract map[int64][]parentbilling.CareContractVersion, order []int64,
	issued map[int64]parentbilling.CareContractChild,
) [][]int64 {
	identities := contractChildrenOf(byContract)
	order = slices.Clone(order)
	outside := map[int64]bool{}
	for _, id := range slices.Sorted(maps.Keys(issued)) {
		if _, inForce := identities[id]; !inForce {
			identities[id] = issued[id]
			order = append(order, id)
			outside[id] = true
		}
	}
	return groupCareChildren(identities, order, outside)
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
