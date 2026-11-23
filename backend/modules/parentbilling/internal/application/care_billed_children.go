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
// child is held back when a contract of it would bill a stale day of an
// invoice of another of its contracts: the run issues no invoice for the
// child and the review names it with the invoice in its way, until the
// office cancels that invoice. Under the full month every invoice bills the
// whole month, so one stale invoice holds the child; pro rata a contract
// that bills its own days next to an invoice for other days is billed.
//
// The issued invoice of a contract that carries only its Mensa bills no care.
// A contract has one invoice a month, so its care stays unbilled until the
// office cancels that invoice; the review names it the same way.
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

// billedChild is a child with an issued invoice of the month: its contracts
// in force without one (open), its contracts whose invoice blocks their care
// and the days and documents of its stale invoices.
type billedChild struct {
	open, blocked []int64
	stale         monthDays
	staleBy       []parentbilling.CareBilledInvoice
}

// billedChildHolds finds the children an issued invoice of the month
// already bills and marks their contracts as held. It leaves a child held
// for a duplicate contract (E4) as it is. The contracts an earlier
// computation of the month held (keepHeld) stay held.
func billedChildHolds(in billedHoldInput, held map[int64]bool) []parentbilling.CareBilledChild {
	holds := in.findBilledChildren(held)
	for contractID := range in.keepHeld {
		held[contractID] = true
	}
	return holds
}

// findBilledChildren is billedChildHolds for the contracts of this
// computation.
func (in billedHoldInput) findBilledChildren(held map[int64]bool) []parentbilling.CareBilledChild {
	holds := []parentbilling.CareBilledChild{}
	if len(in.invoiced) == 0 {
		return holds
	}
	children, keys := in.billedChildren(held)
	for _, key := range keys {
		child := children[key]
		if in.billsStaleDay(child) {
			for _, contractID := range child.open {
				held[contractID] = true
			}
			holds = append(holds, in.hold(parentbilling.HoldReasonAlreadyBilled, slices.Concat(child.open, child.blocked),
				slices.Concat(child.staleBy, in.documents(child.blocked))))
			continue
		}
		for _, contractID := range child.blocked {
			holds = append(holds, in.hold(parentbilling.HoldReasonMealOnlyInvoice, []int64{contractID}, in.documents([]int64{contractID})))
		}
	}
	return holds
}

// billedChildren groups the contracts of the month by child and keeps the
// children with an issued invoice, in the order of their first contract in
// force. A child held for a duplicate contract stays out.
func (in billedHoldInput) billedChildren(held map[int64]bool) (map[string]*billedChild, []string) {
	children := map[string]*billedChild{}
	duplicate := map[string]bool{}
	var keys []string
	for _, contractID := range slices.Sorted(maps.Keys(in.invoiced)) {
		key := in.childOf[contractID]
		if key == "" {
			continue
		}
		if children[key] == nil {
			children[key] = &billedChild{}
		}
		in.addIssued(children[key], contractID)
	}
	for _, contractID := range in.order {
		key := in.childOf[contractID]
		child := children[key]
		if child == nil {
			continue
		}
		if _, seen := duplicate[key]; !seen {
			keys = append(keys, key)
		}
		duplicate[key] = duplicate[key] || held[contractID]
		if _, issued := in.invoiced[contractID]; !issued {
			child.open = append(child.open, contractID)
		}
	}
	return children, slices.DeleteFunc(keys, func(key string) bool { return duplicate[key] })
}

// addIssued adds an issued contract to its child: the days its invoice is
// stale on, or the contract itself when its invoice blocks its care.
func (in billedHoldInput) addIssued(child *billedChild, contractID int64) {
	if in.blocked(contractID) {
		child.blocked = append(child.blocked, contractID)
		return
	}
	stale := billedDays(in.month, in.invoiced[contractID]) &^ in.billingDays(contractID)
	if stale == 0 {
		return
	}
	child.stale |= stale
	child.staleBy = append(child.staleBy, in.documents([]int64{contractID})...)
}

// billsStaleDay tells whether a contract of the child would bill a day one
// of its stale invoices bills already. A contract of a free month or without
// a price bills nothing (wouldBill).
func (in billedHoldInput) billsStaleDay(child *billedChild) bool {
	if child.stale == 0 {
		return false
	}
	return slices.ContainsFunc(slices.Concat(child.open, child.blocked), func(contractID int64) bool {
		return in.billingDays(contractID)&child.stale != 0 && in.wouldBill(contractID)
	})
}

// documents names the issued documents of the contracts that are in the
// way: the Jahresbescheid when it assesses the month, else the monthly
// invoice.
func (in billedHoldInput) documents(contractIDs []int64) []parentbilling.CareBilledInvoice {
	documents := []parentbilling.CareBilledInvoice{}
	for _, contractID := range contractIDs {
		invoice := in.invoiced[contractID]
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

// hold is the entry of the review for the contracts in force of a child:
// those without an invoice in the order of the run, then those whose invoice
// blocks their care.
func (in billedHoldInput) hold(reason string, contractIDs []int64, documents []parentbilling.CareBilledInvoice) parentbilling.CareBilledChild {
	head := in.byContract[contractIDs[0]][0]
	return parentbilling.CareBilledChild{ChildFirstName: head.ChildFirstName, ChildLastName: head.ChildLastName, Reason: reason,
		Contracts: childContracts(contractIDs, in.byContract), Invoices: documents}
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
