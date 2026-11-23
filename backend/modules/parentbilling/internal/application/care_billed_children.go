package application

import (
	"maps"
	"slices"

	"github.com/moto-ogs/project-phoenix/modules/parentbilling"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

// "Already billed" counts per child, not per contract (ADR 0158, Nachtrag
// "Schon abgerechnet je Kind", #7892). An issued invoice of the month, or a
// month of a Jahresbescheid, keeps what it billed, whatever the contracts are
// today. It is stale on the days it bills care for on which its contract
// bills nothing by E2 today: the contract was withdrawn or shortened, or
// another contract of the child now holds on the 1st or is its entry. A
// child is held back when a contract of it without an invoice would bill a
// stale day of an invoice of another of its contracts: the run issues no
// invoice for the child and the review names it with the invoices in its
// way, until the office cancels them. Under the full month every invoice
// bills the whole month, so one stale invoice holds the child; pro rata a
// contract that bills its own days next to an invoice for other days is
// billed.
//
// The issued invoice of a contract that carries only its Mensa bills no care.
// A contract has one invoice a month, so its care stays unbilled until the
// office cancels that invoice. The review names such a contract in an entry
// of its own; it never holds another contract back. Once its invoice is
// cancelled it has none, and a stale day it would bill holds its child (S3).
//
// A run of Jahresbescheide keeps the assessment of a contract it cannot
// price (S11). Pro rata that assessment still bills the days its contract no
// longer runs. A contract of the child without a kept assessment that would
// assess such a day anew holds the child like an issued invoice (S3, S4),
// and the review names the kept notice in its way (#7952): the office gives
// the contract its price, then the run assesses the month anew. The contract
// without a price stays under "Ohne Preis".
//
// billedChildHolds is pure: it reads only its arguments.

// monthDays is a set of days of one month: bit n-1 is the n-th day.
type monthDays uint32

// daysBetween are the days from from to until within the month; a span
// without its days is the whole month.
func daysBetween(month, from, until calendar.Date) monthDays {
	end := monthEnd(month)
	if from.IsZero() || from.Before(month) {
		from = month
	}
	if until.IsZero() || until.After(end) {
		until = end
	}
	if from.After(until) {
		return 0
	}
	return monthDays(1)<<until.Day() - monthDays(1)<<(from.Day()-1)
}

// billedDays are the days the issued invoice of a contract bills care on:
// the spans of its positions.
func billedDays(month calendar.Date, invoice parentbilling.CareInvoice) monthDays {
	var days monthDays
	for _, position := range invoice.Positions {
		days |= daysBetween(month, position.ServiceFrom, position.ServiceUntil)
	}
	return days
}

// billedHoldInput is what billedChildHolds reads of a month: its input, the
// versions by contract in their order, the child of every contract as the
// sibling chain counts it (careGrouping.keys), the entries of the month (E2)
// and the prices.
type billedHoldInput struct {
	careMonthInput
	byContract map[int64][]parentbilling.CareContractVersion
	order      []int64
	childOf    map[int64]string
	entries    map[int64]bool
	prices     priceBook
	free       freeMonths
}

// billingDays are the days a contract bills care on by E2 today: the runs
// of its modules. A contract outside the versions in force bills none.
func (in billedHoldInput) billingDays(contractID int64) monthDays {
	var days monthDays
	for _, track := range tracksOf(in.month, in.rule, in.byContract[contractID], in.entries[contractID]) {
		for _, run := range track.runs {
			days |= daysBetween(in.month, run.from, run.until)
		}
	}
	return days
}

// wouldBill tells whether a contract in force would get an invoice with care
// positions today (S3): its month is not free of charge and every weekday it
// bills has a price. A contract without a price stays under "Ohne Preis" and
// holds nobody back.
func (in billedHoldInput) wouldBill(contractID int64) bool {
	versions := in.byContract[contractID]
	if in.free.free(versions[0].SchoolID, in.month) {
		return false
	}
	draft, unpriced := billContract(in.month, in.rule, versions, in.entries[contractID], in.prices)
	return len(unpriced) == 0 && len(draft.Positions) > 0
}

// blocked tells whether the issued invoice of a contract in force carries
// only its Mensa while the contract would bill care today.
func (in billedHoldInput) blocked(contractID int64) bool {
	invoice := in.invoiced[contractID]
	if _, inForce := in.byContract[contractID]; !inForce || len(invoice.Positions) > 0 ||
		invoice.DocumentKind == parentbilling.DocumentKindFeeNotice {
		return false
	}
	return in.wouldBill(contractID)
}

// staleInvoice is the issued invoice of a contract with the days it is
// stale on.
type staleInvoice struct {
	contractID int64
	days       monthDays
}

// billedChild is a child with an issued invoice of the month or a kept
// assessment: its contracts in force without an invoice (open), its contracts
// whose invoice carries only the Mensa while they would bill care
// (mealOnly), its stale invoices and its stale kept assessments (kept).
// Contracts held for a duplicate (E4) are in no list.
type billedChild struct {
	open, mealOnly []int64
	stale, kept    []staleInvoice
}

// staleDays are the days any of the stale documents bills.
func staleDays(stale []staleInvoice) monthDays {
	var days monthDays
	for _, invoice := range stale {
		days |= invoice.days
	}
	return days
}

// billedChildHolds finds the children an issued invoice of the month
// already bills and marks their contracts as held, those of the invoices in
// their way too, so their Mensa waits as well (careMonth.held). The entry
// names those invoices, so the run of their school shows it (narrowChildren). A contract held for a
// duplicate (E4) stays under its duplicate; other contracts of its child are
// held like any. The second computation of a notice month only adopts what
// the first one held (keepHeld) and finds nobody new: an assessment it took
// back as issued is no reason to hold a child the review showed as billed.
func billedChildHolds(in billedHoldInput, held map[int64]bool) []parentbilling.CareBilledChild {
	if in.keepHeld != nil {
		for contractID := range in.keepHeld {
			held[contractID] = true
		}
		return []parentbilling.CareBilledChild{}
	}
	holds := []parentbilling.CareBilledChild{}
	if len(in.invoiced) == 0 && len(in.assessed) == 0 {
		return holds
	}
	children, keys := in.billedChildren(held)
	for _, key := range keys {
		child := children[key]
		holds = append(holds, in.staleHolds(child, held)...)
		// The care behind an invoice with only the Mensa is open (S5), whether
		// the child is held or not: the office cancels that invoice.
		for _, contractID := range child.mealOnly {
			holds = append(holds, in.hold(parentbilling.HoldReasonMealOnlyInvoice, []int64{contractID}, []int64{contractID}))
		}
	}
	return holds
}

// staleHolds holds a child whose open contract would bill a stale day: of
// an issued invoice (S3, S4) or else of a kept assessment (#7952).
func (in billedHoldInput) staleHolds(child *billedChild, held map[int64]bool) []parentbilling.CareBilledChild {
	if inTheWay := in.staleInTheWay(child.open, child.stale); len(inTheWay) > 0 {
		// The whole child, with the Mensa of the contracts in its way (S4).
		for _, contractID := range slices.Concat(child.open, inTheWay) {
			held[contractID] = true
		}
		return []parentbilling.CareBilledChild{in.hold(parentbilling.HoldReasonAlreadyBilled, child.open, inTheWay)}
	}
	inTheWay := in.staleInTheWay(child.open, child.kept)
	if len(inTheWay) == 0 {
		return nil
	}
	// The contracts without a price keep their assessment and stay under
	// "Ohne Preis"; every other contract of the child waits.
	open := slices.DeleteFunc(slices.Clone(child.open), func(contractID int64) bool {
		return slices.ContainsFunc(child.kept, func(kept staleInvoice) bool { return kept.contractID == contractID })
	})
	for _, contractID := range open {
		held[contractID] = true
	}
	return []parentbilling.CareBilledChild{in.hold(parentbilling.HoldReasonUnpricedNotice, open, inTheWay)}
}

// childEntry answers the entry of a child, adding it on first use.
func childEntry(children map[string]*billedChild, key string) *billedChild {
	if children[key] == nil {
		children[key] = &billedChild{}
	}
	return children[key]
}

// addKept adds the stale days of the assessments a run of Jahresbescheide
// keeps for a missing price to their children (#7952).
func (in billedHoldInput) addKept(children map[string]*billedChild, held map[int64]bool) {
	for _, contractID := range in.order {
		key := in.childOf[contractID]
		if key == "" || !in.keptForPrice(contractID, held) {
			continue
		}
		if stale := billedDays(in.month, in.assessed[contractID]) &^ in.billingDays(contractID); stale != 0 {
			child := childEntry(children, key)
			child.kept = append(child.kept, staleInvoice{contractID: contractID, days: stale})
		}
	}
}

// billedChildren groups the contracts of the month by child and keeps the
// children with an issued invoice, in the order of their first contract in
// force.
func (in billedHoldInput) billedChildren(held map[int64]bool) (map[string]*billedChild, []string) {
	children := map[string]*billedChild{}
	var keys []string
	for _, contractID := range slices.Sorted(maps.Keys(in.invoiced)) {
		key := in.childOf[contractID]
		if key == "" {
			continue
		}
		in.addIssued(childEntry(children, key), contractID, held[contractID])
	}
	in.addKept(children, held)
	listed := map[string]bool{}
	for _, contractID := range in.order {
		key := in.childOf[contractID]
		child := children[key]
		if child == nil {
			continue
		}
		if !listed[key] {
			listed[key] = true
			keys = append(keys, key)
		}
		if _, issued := in.invoiced[contractID]; !issued && !held[contractID] {
			child.open = append(child.open, contractID)
		}
	}
	return children, keys
}

// addIssued adds an issued contract to its child: the days its invoice is
// stale on, or the contract itself when its invoice carries only the Mensa
// and it would bill care. A contract held for a duplicate is named there.
func (in billedHoldInput) addIssued(child *billedChild, contractID int64, duplicate bool) {
	if in.blocked(contractID) {
		if !duplicate {
			child.mealOnly = append(child.mealOnly, contractID)
		}
		return
	}
	if stale := billedDays(in.month, in.invoiced[contractID]) &^ in.billingDays(contractID); stale != 0 {
		child.stale = append(child.stale, staleInvoice{contractID: contractID, days: stale})
	}
}

// keptForPrice tells whether a run of Jahresbescheide keeps the assessment
// of a contract it computes again because a booked weekday has no price
// (S11), as buildCareMonth decides it: a contract in force, held for no
// duplicate, its month not free of charge.
func (in billedHoldInput) keptForPrice(contractID int64, held map[int64]bool) bool {
	versions, inForce := in.byContract[contractID]
	if _, assessed := in.assessed[contractID]; !assessed || !inForce || held[contractID] ||
		in.free.free(versions[0].SchoolID, in.month) {
		return false
	}
	_, unpriced := billContract(in.month, in.rule, versions, in.entries[contractID], in.prices)
	return len(unpriced) > 0
}

// staleInTheWay names the contracts whose stale documents bill a day an
// open contract of the child would bill (S3); empty when none does. A
// contract of a free month or without a price bills nothing (wouldBill), and
// a contract with an invoice of its own triggers nothing.
func (in billedHoldInput) staleInTheWay(open []int64, stale []staleInvoice) []int64 {
	all := staleDays(stale)
	if all == 0 {
		return nil
	}
	var billing monthDays
	for _, contractID := range open {
		if days := in.billingDays(contractID); days&all != 0 && in.wouldBill(contractID) {
			billing |= days
		}
	}
	var inTheWay []int64
	for _, invoice := range stale {
		if invoice.days&billing != 0 {
			inTheWay = append(inTheWay, invoice.contractID)
		}
	}
	return inTheWay
}

// documents names the issued documents of the contracts that are in the
// way: the Jahresbescheid when it assesses the month, else the monthly
// invoice; for a kept assessment its Jahresbescheid.
func (in billedHoldInput) documents(contractIDs []int64) []parentbilling.CareBilledInvoice {
	documents := []parentbilling.CareBilledInvoice{}
	for _, contractID := range contractIDs {
		invoice, issued := in.invoiced[contractID]
		if !issued {
			invoice = in.assessed[contractID]
		}
		source := parentbilling.BilledByCareRun
		if invoice.DocumentKind == parentbilling.DocumentKindFeeNotice {
			source = parentbilling.BilledByNoticeRun
		}
		named := false
		for _, document := range invoice.BilledBy {
			if document.Source == source {
				documents, named = append(documents, document), true
			}
		}
		if !named {
			// An entry without its documents still names contract and school.
			documents = append(documents, parentbilling.CareBilledInvoice{Source: source, ContractID: ident.ID(contractID),
				SchoolID: invoice.SchoolID, SchoolName: invoice.SchoolName, Number: invoice.Number})
		}
	}
	return documents
}

// hold is the entry of the review for contracts in force of a child, with
// the documents of the issued contracts in their way.
func (in billedHoldInput) hold(reason string, contractIDs, issued []int64) parentbilling.CareBilledChild {
	head := in.byContract[contractIDs[0]][0]
	return parentbilling.CareBilledChild{ChildFirstName: head.ChildFirstName, ChildLastName: head.ChildLastName, Reason: reason,
		Contracts: childContracts(contractIDs, in.byContract), Invoices: in.documents(issued)}
}

// appendBilledChildren adds the contracts of the children held for an
// issued invoice and the contracts of those invoices.
func appendBilledChildren(ids []int64, children []parentbilling.CareBilledChild) []int64 {
	for _, child := range children {
		ids = appendContracts(ids, child.Contracts)
		for _, invoice := range child.Invoices {
			if !slices.Contains(ids, invoice.ContractID.Int64()) {
				ids = append(ids, invoice.ContractID.Int64())
			}
		}
	}
	return ids
}
