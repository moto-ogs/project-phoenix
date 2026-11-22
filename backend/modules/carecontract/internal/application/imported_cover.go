package application

import (
	"context"

	"github.com/moto-ogs/project-phoenix/modules/carecontract"
	"github.com/moto-ogs/project-phoenix/modules/carecontract/internal/ports"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

// contractedKeys are the application children of the schools that have a
// contract, in one read: the keys of the contracts from applications, and every
// application child an imported contract covers already (#7760). The second
// part closes a gap of the import (ADR 0232): an imported contract has no
// application child as its key, so without it a child with a running
// imported contract became a candidate for a second contract as soon as it
// had an accepted application, and both were billed.
//
// named are those of them only an imported contract covers, with that
// contract. The list of candidates shows such a child held back with the
// contract instead of dropping it: the office sees why no contract is
// offered, and can link the contract, correct it or end it.
func (in *Intake) contractedKeys(ctx context.Context, organizationID int64, reads []schoolRead) (existing map[ContractKey]bool, named map[ContractKey]int64, err error) {
	children, err := in.store.ContractChildren(ctx, organizationID, readSchoolIDs(reads))
	if err != nil {
		return nil, nil, err
	}
	existing, named = map[ContractKey]bool{}, map[ContractKey]int64{}
	for _, child := range children {
		if child.RequestChildID != nil {
			existing[ContractKey{SchoolID: child.SchoolID, RequestChildID: *child.RequestChildID}] = true
		}
	}
	for key, contractID := range importCoverage(reads, children, in.today()) {
		if !existing[key] {
			named[key] = contractID
		}
		existing[key] = true
	}
	return existing, named, nil
}

// withoutNamed are the keys with a contract without those only an imported
// contract covers: the list of candidates keeps these children.
func withoutNamed(existing map[ContractKey]bool, named map[ContractKey]int64) map[ContractKey]bool {
	kept := make(map[ContractKey]bool, len(existing))
	for key := range existing {
		if named[key] == 0 {
			kept[key] = true
		}
	}
	return kept
}

// markNamedByImport holds back every candidate an imported contract covers
// and tells which: no second contract is created for the time they share.
func markNamedByImport(candidates []carecontract.Candidate, named map[ContractKey]int64) {
	for n := range candidates {
		key := ContractKey{SchoolID: candidates[n].SchoolID.Int64(), RequestChildID: candidates[n].RequestChildID.Int64()}
		if id := named[key]; id > 0 {
			candidates[n].TemplateIssue, candidates[n].ImportedContractID = carecontract.SkipImportedContract, ident.ID(id)
		}
	}
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
	for key := range importCoverage(reads, children, today) {
		covered[key] = true
	}
	return covered
}

// importCoverage answers coveredByImport with the covering contract. A
// contract linked to the child's record goes before one that only names it.
func importCoverage(reads []schoolRead, children []ports.ContractChild, today calendar.Date) map[ContractKey]int64 {
	covered := map[ContractKey]int64{}
	imported := runningImports(children)
	for _, read := range reads {
		contracts := imported[read.school.ID]
		if len(contracts) == 0 {
			continue
		}
		for _, application := range read.applications {
			if cover, ok := importCovers(read, application, contracts, today); ok {
				covered[ContractKey{SchoolID: read.school.ID, RequestChildID: application.RequestChildID}] = cover
			}
		}
	}
	return covered
}

// runningImports are the imported contracts that hold or held, per school:
// all but a withdrawn one, which never held, and an ended one without a last
// day. A contract that ended before today still counts: a contract from an
// application may begin in the past, and both would bill the days they
// share. The time each contract holds decides in importCovers.
func runningImports(children []ports.ContractChild) map[int64][]ports.ContractChild {
	imported := map[int64][]ports.ContractChild{}
	for _, child := range children {
		held := child.Status != carecontract.StatusWithdrawn && (child.Status != carecontract.StatusEnded || child.EndsOn != nil)
		if child.ImportOrigin != "" && held {
			imported[child.SchoolID] = append(imported[child.SchoolID], child)
		}
	}
	return imported
}

// importCovers answers the imported contract that is the application
// child's and holds on a day of its booked care.
func importCovers(read schoolRead, application carecontract.Application, contracts []ports.ContractChild, today calendar.Date) (int64, bool) {
	care := bookedCare(read, application, today)
	if len(care.services) == 0 {
		return 0, false
	}
	from, until := care.effectiveFrom(application, today), lastDay(care.until)
	var named int64
	for _, contract := range contracts {
		if !importedContractOf(read.school.ID, application, contract) || !periodsOverlap(from, until, contract.StartsOn, contract.EndsOn) {
			continue
		}
		if contract.StudentID != nil && application.StudentID != nil {
			return contract.ContractID, true
		}
		if named == 0 {
			named = contract.ContractID
		}
	}
	return named, named > 0
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
