package application

import (
	"context"
	"fmt"
	"strconv"

	"github.com/moto-ogs/project-phoenix/modules/parentbilling"
)

// Deciding the numbers a file names for families (#7356), for the numbers'
// own file and for the column of an import of contracts alike: rows of one
// family that disagree take over none, a confirmed number stays, a new one
// is taken over as confirmed by the office.

// importedChildren is a number a file names with the family it belongs to
// and what the import does with it.
type importedChildren struct {
	number parentbilling.ImportedFamilyChildren
	// family is the key of the family: number.FamilyEmail holds it after
	// the decision.
	family string
	status string
	// confirmed is the number the Abrechnung confirmed before, for a row
	// that is the same or differs.
	confirmed *int
}

// previewChildrenFamily keys a row of a preview without a mail address and
// without a contract: the family its contract will be, which no stored
// number and no other row shares. It is never stored.
func previewChildrenFamily(line int) string { return previewFamilyPrefix + strconv.Itoa(line) }

// importedChildrenFamily is the family a number goes to: the mail address
// of the contract's party, else the contract itself, else the row.
func importedChildrenFamily(number parentbilling.ImportedFamilyChildren) string {
	if key := parentbilling.ContractFamilyKey(number.FamilyEmail, number.ContractID); key != "" {
		return key
	}
	return previewChildrenFamily(number.Line)
}

// decideImportedChildren gives every row its status. confirmedOf answers
// the number the Abrechnung confirmed for a family, nil without one.
func decideImportedChildren(rows []importedChildren, confirmedOf func(family string) *int) {
	distinct := map[string]map[int]bool{}
	for _, row := range rows {
		if row.status != "" {
			continue
		}
		if distinct[row.family] == nil {
			distinct[row.family] = map[int]bool{}
		}
		distinct[row.family][row.number.Children] = true
	}
	for i := range rows {
		row := &rows[i]
		if row.status != "" {
			continue
		}
		confirmed := confirmedOf(row.family)
		switch {
		case len(distinct[row.family]) > 1:
			row.status = parentbilling.ImportedChildrenRowsDiffer
		case confirmed == nil:
			row.status = parentbilling.ImportedChildrenNew
		case *confirmed == row.number.Children:
			row.status, row.confirmed = parentbilling.ImportedChildrenSame, confirmed
		default:
			row.status, row.confirmed = parentbilling.ImportedChildrenDiffers, confirmed
		}
	}
}

// newImportedChildren are the numbers to store: each family once, from the
// earliest first day its rows name, on the contract of that row. A row of a
// preview names no family to keep.
func newImportedChildren(rows []importedChildren) []parentbilling.ImportedFamilyChildren {
	var numbers []parentbilling.ImportedFamilyChildren
	at := map[string]int{}
	for _, row := range rows {
		if row.status != parentbilling.ImportedChildrenNew || row.number.ContractID <= 0 {
			continue
		}
		number := row.number
		number.FamilyEmail = row.family
		position, seen := at[row.family]
		switch {
		case !seen:
			at[row.family] = len(numbers)
			numbers = append(numbers, number)
		case number.ValidFrom.Before(numbers[position].ValidFrom):
			numbers[position] = number
		}
	}
	return numbers
}

// saveImportedChildren takes the new numbers over under the lock of the
// monthly billing, so a release counts a family before or after the
// import, never in between.
func (f *FamilyNumbers) saveImportedChildren(ctx context.Context, reviewer parentbilling.HolidayReviewer, rows []importedChildren) error {
	numbers := newImportedChildren(rows)
	if len(numbers) == 0 {
		return nil
	}
	if err := f.store.LockCareBilling(ctx, reviewer.OrganizationID); err != nil {
		return fmt.Errorf("parent billing: hold the monthly billing: %w", err)
	}
	if err := f.store.ConfirmImportedFamilyChildren(ctx, reviewer.OrganizationID, reviewer.AccountID, numbers); err != nil {
		return fmt.Errorf("parent billing: take over the numbers of the families: %w", err)
	}
	return nil
}

// DecideImportedFamilyChildren decides the numbers an import of contracts
// names and, with save, stores the new ones for the contracts just stored.
// A family is the mail address of the row's party, else its contract: a
// number another contract brought along does not speak for it here.
func (f *FamilyNumbers) DecideImportedFamilyChildren(ctx context.Context, reviewer parentbilling.HolidayReviewer,
	numbers []parentbilling.ImportedFamilyChildren, save bool,
) ([]parentbilling.ImportedFamilyChildrenDecision, error) {
	if err := validReviewer(reviewer); err != nil {
		return nil, err
	}
	if len(numbers) == 0 {
		return []parentbilling.ImportedFamilyChildrenDecision{}, nil
	}
	counts, err := f.store.FamilyChildCounts(ctx, reviewer.OrganizationID)
	if err != nil {
		return nil, err
	}
	confirmed := map[string]*int{}
	var read []parentbilling.FamilyChildTarget
	rows := make([]importedChildren, len(numbers))
	wanted := map[string]bool{}
	for i, number := range numbers {
		rows[i] = importedChildren{number: number, family: importedChildrenFamily(number)}
		if validChildren(number.Children) != nil {
			rows[i].status = parentbilling.ImportedChildrenInvalid
		}
		wanted[rows[i].family] = true
	}
	for i := range counts {
		if wanted[counts[i].FamilyEmail] && counts[i].ConfirmedChildren != nil {
			confirmed[counts[i].FamilyEmail] = counts[i].ConfirmedChildren
			read = append(read, parentbilling.FamilyChildTarget{ContractID: counts[i].ContractID, CountID: &counts[i].ID})
		}
	}
	// The answer tells whether a family has the number or another one: a
	// read of that number, recorded like the list of the families.
	event := parentbilling.FamilyChildEvent{Action: parentbilling.FamilyChildEventRead, Actor: parentbilling.FamilyChildActorOffice,
		AccountID: reviewer.AccountID}
	if err := f.store.InsertFamilyChildEvents(ctx, reviewer.OrganizationID, event, read); err != nil {
		return nil, fmt.Errorf("parent billing: record family child count read: %w", err)
	}
	decideImportedChildren(rows, func(family string) *int { return confirmed[family] })
	if save {
		if err := f.saveImportedChildren(ctx, reviewer, rows); err != nil {
			return nil, err
		}
	}
	decisions := make([]parentbilling.ImportedFamilyChildrenDecision, len(rows))
	for i, row := range rows {
		decisions[i] = parentbilling.ImportedFamilyChildrenDecision{Line: row.number.Line, Status: row.status}
	}
	return decisions, nil
}
