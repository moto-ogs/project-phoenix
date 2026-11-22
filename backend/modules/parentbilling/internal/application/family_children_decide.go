package application

import (
	"context"
	"fmt"
	"strconv"

	"github.com/moto-ogs/project-phoenix/modules/parentbilling"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
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
	// witness marks a row that takes over nothing itself, as it names a
	// child a second time, but whose number still speaks against the other
	// rows of its family.
	witness bool
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

// decideImportedChildren gives every row its status. day answers the day
// a row's number has to hold on; current the number the Abrechnung
// confirmed for a family that decides that day, nil without one. A
// confirmation that ended before that day no longer speaks: the file renews
// it from the day after its end, so the months it covered keep what they
// had.
func decideImportedChildren(rows []importedChildren, current func(family string, day calendar.Date) *parentbilling.FamilyChildCount,
	day func(row importedChildren) calendar.Date,
) {
	distinct := distinctImportedChildren(rows)
	for i := range rows {
		row := &rows[i]
		if row.status != "" || row.witness {
			continue
		}
		count := current(row.family, day(*row))
		switch {
		case len(distinct[row.family]) > 1:
			row.status = parentbilling.ImportedChildrenRowsDiffer
		case count == nil || count.ConfirmedChildren == nil:
			row.status = parentbilling.ImportedChildrenNew
		case count.ValidUntil != nil && count.ValidUntil.Before(day(*row)):
			row.status = parentbilling.ImportedChildrenNew
			if next := count.ValidUntil.AddDays(1); next.After(row.number.ValidFrom) {
				row.number.ValidFrom = next
			}
		case *count.ConfirmedChildren == row.number.Children:
			row.status, row.confirmed = parentbilling.ImportedChildrenSame, count.ConfirmedChildren
		default:
			row.status, row.confirmed = parentbilling.ImportedChildrenDiffers, count.ConfirmedChildren
		}
	}
}

// distinctImportedChildren collects per family the numbers its rows name,
// those of a witness included.
func distinctImportedChildren(rows []importedChildren) map[string]map[int]bool {
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
	return distinct
}

// newImportedChildren are the numbers to store: each family once, from the
// earliest first day its rows name, on the contract of that row. A row of a
// preview names no family to keep.
func newImportedChildren(rows []importedChildren) []parentbilling.ImportedFamilyChildren {
	var numbers []parentbilling.ImportedFamilyChildren
	at := map[string]int{}
	for _, row := range rows {
		if row.witness || row.status != parentbilling.ImportedChildrenNew || row.number.ContractID <= 0 {
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

// holdForImport holds the monthly billing of the Träger before an import
// reads the numbers it decides on: a release counts a family before or
// after the import, never in between, and a confirmation made meanwhile is
// read, not overwritten.
func (f *FamilyNumbers) holdForImport(ctx context.Context, organizationID int64) error {
	if err := f.store.LockCareBilling(ctx, organizationID); err != nil {
		return fmt.Errorf("parent billing: hold the monthly billing: %w", err)
	}
	return nil
}

// saveImportedChildren takes the new numbers over; the caller holds the
// monthly billing (holdForImport).
func (f *FamilyNumbers) saveImportedChildren(ctx context.Context, reviewer parentbilling.HolidayReviewer, rows []importedChildren) error {
	numbers := newImportedChildren(rows)
	if len(numbers) == 0 {
		return nil
	}
	if err := f.store.ConfirmImportedFamilyChildren(ctx, reviewer.OrganizationID, reviewer.AccountID, numbers); err != nil {
		return fmt.Errorf("parent billing: take over the numbers of the families: %w", err)
	}
	return nil
}

// confirmedOfRows answers the confirmed numbers of the rows' families by
// their key, and the numbers a decision reads.
func confirmedOfRows(counts []parentbilling.FamilyChildCount, rows []importedChildren) (map[string]*parentbilling.FamilyChildCount, []parentbilling.FamilyChildTarget) {
	wanted := map[string]bool{}
	for _, row := range rows {
		wanted[row.family] = true
	}
	confirmed := map[string]*parentbilling.FamilyChildCount{}
	var read []parentbilling.FamilyChildTarget
	for i := range counts {
		if wanted[counts[i].FamilyEmail] && counts[i].ConfirmedChildren != nil {
			confirmed[counts[i].FamilyEmail] = &counts[i]
			read = append(read, parentbilling.FamilyChildTarget{ContractID: counts[i].ContractID.Int64(), CountID: (*int64)(&counts[i].ID)})
		}
	}
	return confirmed, read
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
	// The first decision supplies the fingerprint, before contracts exist.
	// Keep it stable until the caller stores the contracts and their numbers.
	if err := f.holdForImport(ctx, reviewer.OrganizationID); err != nil {
		return nil, err
	}
	counts, err := f.store.FamilyChildCounts(ctx, reviewer.OrganizationID)
	if err != nil {
		return nil, err
	}
	rows := make([]importedChildren, len(numbers))
	for i, number := range numbers {
		rows[i] = importedChildren{number: number, family: importedChildrenFamily(number), witness: number.Witness}
		if validChildren(number.Children) != nil {
			rows[i].status = parentbilling.ImportedChildrenInvalid
		}
	}
	confirmed, read := confirmedOfRows(counts, rows)
	// The answer tells whether a family has the number or another one: a
	// read of that number, recorded like the list of the families.
	event := parentbilling.FamilyChildEvent{Action: parentbilling.FamilyChildEventRead, Actor: parentbilling.FamilyChildActorOffice,
		AccountID: reviewer.AccountID}
	if err := f.store.InsertFamilyChildEvents(ctx, reviewer.OrganizationID, event, read); err != nil {
		return nil, fmt.Errorf("parent billing: record family child count read: %w", err)
	}
	// An import of contracts has no clock of its own: a confirmation that
	// ended before the first day of the row's contract has run out.
	decideImportedChildren(rows, func(family string, _ calendar.Date) *parentbilling.FamilyChildCount { return confirmed[family] },
		func(row importedChildren) calendar.Date { return row.number.ValidFrom })
	if save {
		if err := f.saveImportedChildren(ctx, reviewer, rows); err != nil {
			return nil, err
		}
	}
	return familyImportDecisions(rows), nil
}

// Witnesses affect conflicts but receive no import decision themselves.
func familyImportDecisions(rows []importedChildren) []parentbilling.ImportedFamilyChildrenDecision {
	decisions := make([]parentbilling.ImportedFamilyChildrenDecision, 0, len(rows))
	for _, row := range rows {
		if row.witness {
			continue
		}
		decisions = append(decisions, parentbilling.ImportedFamilyChildrenDecision{Line: row.number.Line, Status: row.status})
	}
	return decisions
}
