package application

import (
	"context"

	"github.com/moto-ogs/project-phoenix/modules/carecontract"
	"github.com/moto-ogs/project-phoenix/modules/carecontract/internal/ports"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// contractedKeys are the application children of the schools that have a
// contract, in one read: the keys of the contracts from applications, and every
// application child an imported contract covers already (#7760). The second
// part closes a gap of the import (ADR 0232): an imported contract has no
// application child as its key, so without it a child with a running
// imported contract became a candidate for a second contract as soon as it
// had an accepted application, and both were billed.
func (in *Intake) contractedKeys(ctx context.Context, organizationID int64, reads []schoolRead) (map[ContractKey]bool, error) {
	children, err := in.store.ContractChildren(ctx, organizationID, readSchoolIDs(reads))
	if err != nil {
		return nil, err
	}
	existing := map[ContractKey]bool{}
	for _, child := range children {
		if child.RequestChildID != nil {
			existing[ContractKey{SchoolID: child.SchoolID, RequestChildID: *child.RequestChildID}] = true
		}
	}
	for key := range coveredByImport(reads, children, in.today()) {
		existing[key] = true
	}
	return existing, nil
}

// claimUncovered takes the lock of the Träger's links in the caller's Träger
// transaction and reads the contracts of the key's school again under it
// (#7760): the conclusion at the acceptance read the candidates in an earlier
// transaction, and a link run may since have linked an imported contract
// that covers the child. ErrContractExists then; else no link run changes
// what covers the child until the caller's transaction ends.
func (in *Intake) claimUncovered(ctx context.Context, organizationID int64, reads []schoolRead, key ContractKey) error {
	if err := in.store.LockChildLinks(ctx, organizationID); err != nil {
		return err
	}
	read, ok := findRead(reads, key.SchoolID)
	if !ok {
		return nil
	}
	children, err := in.store.ContractChildren(ctx, organizationID, []int64{key.SchoolID})
	if err != nil {
		return err
	}
	if coveredByImport([]schoolRead{read}, children, in.today())[key] {
		return carecontract.ErrContractExists
	}
	return nil
}

// coveredByImport names the application children whose booked care an
// imported contract of their school covers: the contract still holds, it is
// the child's, and it holds on a day of the booked care. The contract is the
// child's when it is linked to the child record of the application, and,
// while it is linked to none, when it names the child as the import compares
// children (ADR 0232 point 5): the same names and no two different dates of
// birth. An imported contract that ends before the booked care begins covers
// nothing: the child gets its contract for the next phase as before.
func coveredByImport(reads []schoolRead, children []ports.ContractChild, today calendar.Date) map[ContractKey]bool {
	covered := map[ContractKey]bool{}
	imported := runningImports(children, today)
	for _, read := range reads {
		contracts := imported[read.school.ID]
		if len(contracts) == 0 {
			continue
		}
		for _, application := range read.applications {
			if importCovers(read, application, contracts, today) {
				covered[ContractKey{SchoolID: read.school.ID, RequestChildID: application.RequestChildID}] = true
			}
		}
	}
	return covered
}

// runningImports are the imported contracts that still hold on today, per
// school.
func runningImports(children []ports.ContractChild, today calendar.Date) map[int64][]ports.ContractChild {
	imported := map[int64][]ports.ContractChild{}
	for _, child := range children {
		if child.ImportOrigin != "" && holdsOn(child, today) {
			imported[child.SchoolID] = append(imported[child.SchoolID], child)
		}
	}
	return imported
}

// importCovers tells whether one of the imported contracts is the
// application child's and holds on a day of its booked care.
func importCovers(read schoolRead, application carecontract.Application, contracts []ports.ContractChild, today calendar.Date) bool {
	care := bookedCare(read, application, today)
	if len(care.services) == 0 {
		return false
	}
	from, until := care.effectiveFrom(application, today), lastDay(care.until)
	for _, contract := range contracts {
		if importedContractOf(read.school.ID, application, contract) && periodsOverlap(from, until, contract.StartsOn, contract.EndsOn) {
			return true
		}
	}
	return false
}

// importedContractOf tells whether an imported contract is the application
// child's: both name a child record and it is the same one; else, when the
// contract is linked to none or the application names none, the contract
// names the child.
func importedContractOf(schoolID int64, application carecontract.Application, contract ports.ContractChild) bool {
	if contract.StudentID != nil && application.StudentID != nil {
		return *contract.StudentID == *application.StudentID
	}
	return childKeyOf(schoolID, application.ChildFirstName, application.ChildLastName, application.ChildBirthDate).
		same(childKeyOf(contract.SchoolID, contract.FirstName, contract.LastName, contract.BirthDate))
}
