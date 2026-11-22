package carecontract

import (
	"context"
	"errors"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

// The link of an imported contract to the child record of its school (#7760,
// ADR 0232 point 6 and its addendum of 22.11.2026). An import stores a
// contract with its own copy of the child and links no child record: a name
// and a date of birth do not prove who a child is (ADR 0214). This is the
// step that proves it: the office names the contract and the child record by
// their identifiers, in a file for many contracts or by hand for one.
//
// Invariants:
//   - The identifiers decide. The name and the date of birth of the contract
//     and of the child record are only compared: a difference holds the row
//     back, an agreement links nothing on its own.
//   - A row that is unclear or contradicts another one links nothing and
//     says why.
//   - A repeated run links nothing twice: a contract linked to the child the
//     file names is answered as linked.
//   - The link changes the contract's child record and nothing else: no
//     version, no document, no party, no mandate. It sends no message and
//     starts no invoice or payment run.
//   - Only a contract from an import is linked or unlinked here. A contract
//     from an application has the child of its application (ADR 0153).
//   - The file itself is never stored.

// Fields of a link a column of the file names.
const (
	ChildLinkFieldContract = "contract"
	ChildLinkFieldChild    = "child"
)

// What a run does with a row.
const (
	// ChildLinkReady is linked as it is.
	ChildLinkReady = "ready"
	// ChildLinkLinked is a contract linked to the named child already: a
	// repeated run skips it.
	ChildLinkLinked = "linked"
	// ChildLinkStored is a row the run linked.
	ChildLinkStored = "stored"
	// ChildLinkConflict is unclear or contradicts what moto or another row
	// says; it is shown and never linked by a file.
	ChildLinkConflict = "conflict"
	// ChildLinkInvalid misses an identifier or names one moto does not have.
	ChildLinkInvalid = "invalid"
)

// Problems of a row. Each names a field and a code; none repeats a value.
const (
	ChildLinkProblemMissing = "missing"
	// ChildLinkProblemInvalid is a value that is no identifier: no whole
	// number above zero.
	ChildLinkProblemInvalid = "invalid"
	// ChildLinkProblemUnknown is a contract the Träger does not have, or a
	// child record the school of the contract does not have.
	ChildLinkProblemUnknown = "unknown"
	// ChildLinkProblemNotImported is a contract from an application.
	ChildLinkProblemNotImported = "not_imported"
	// ChildLinkProblemRepeated is a contract or a child another row of the
	// file names.
	ChildLinkProblemRepeated = "repeated"
	// ChildLinkProblemLinkedOther is a contract linked to another child.
	ChildLinkProblemLinkedOther = "linked_other"
	// ChildLinkProblemHasContract is a child with another running contract
	// at the school in the same time.
	ChildLinkProblemHasContract = "has_contract"
	// ChildLinkProblemDiffers is a child record whose name or date of birth
	// is not the contract's.
	ChildLinkProblemDiffers = "differs"
)

var (
	// ErrChildLinkChanged reports a run whose rows no longer are what the
	// office confirmed in the preview, or a contract to unlink that has
	// another child record than the office saw. The office looks again.
	ErrChildLinkChanged = errors.New("the links differ from the confirmed preview")
	// ErrChildLinkRefused reports a single link that cannot be stored as
	// asked: the answer of the preview names why.
	ErrChildLinkRefused = errors.New("the contract cannot be linked to this child record")
	// ErrChildLinkNotImported reports a contract from an application: it
	// keeps the child of its application.
	ErrChildLinkNotImported = errors.New("only a contract from an import is linked to a child record here")
	// ErrChildLinkBound reports an imported contract bound to the
	// application of its child (ADR 0308): the enrollment and the bookings it
	// follows belong to that child record, so the link stays.
	ErrChildLinkBound = errors.New("the contract is bound to the application of its child")
)

// ChildLinkColumns names per field the header of the column it comes from.
type ChildLinkColumns struct {
	Contract string `json:"contract"`
	Child    string `json:"child"`
}

// ChildLinkRequest is one look at a file: the preview when Apply is not set,
// the link of its ready rows when it is. Columns nil takes the columns moto
// suggests from the headers. Delimiter is ";", "," or "\t", empty detects it.
type ChildLinkRequest struct {
	Content   []byte
	FileName  string
	Delimiter string
	Columns   *ChildLinkColumns
	Apply     bool
	// Fingerprint is the fingerprint of the preview the office confirmed;
	// Apply refuses with ErrChildLinkChanged when the rows differ from it.
	Fingerprint string
}

// ChildLinkProblem is one problem of a row: the field and the code.
type ChildLinkProblem struct {
	Field string `json:"field"`
	Code  string `json:"code"`
}

// ChildLinkRow is one contract with the child record a file or the office
// names for it. The child of the contract is the copy the contract keeps;
// the child record is the one of the school, named only when the school of
// the contract has it.
type ChildLinkRow struct {
	Line       int      `json:"line"`
	Status     string   `json:"status"`
	ContractID ident.ID `json:"contract_id,omitempty"`
	StudentID  ident.ID `json:"student_id,omitempty"`
	SchoolName string   `json:"school_name"`

	ContractChildFirstName string         `json:"contract_child_first_name"`
	ContractChildLastName  string         `json:"contract_child_last_name"`
	ContractChildBirthDate *calendar.Date `json:"contract_child_birth_date"`

	StudentFirstName string         `json:"student_first_name"`
	StudentLastName  string         `json:"student_last_name"`
	StudentBirthDate *calendar.Date `json:"student_birth_date"`

	Problems []ChildLinkProblem `json:"problems"`
	// RepeatsLine is the line of the row that names the same contract or
	// child before this one (ChildLinkProblemRepeated).
	RepeatsLine int `json:"repeats_line,omitempty"`
	// OtherContractID is the contract the child has already
	// (ChildLinkProblemHasContract).
	OtherContractID ident.ID `json:"other_contract_id,omitempty"`
	// Fingerprint names the row as decided, before an accepted difference;
	// only a single link answers it. The link takes the row only with it.
	Fingerprint string `json:"fingerprint,omitempty"`
}

// ChildLinkCounts counts the rows per status.
type ChildLinkCounts struct {
	Ready    int `json:"ready"`
	Linked   int `json:"linked"`
	Stored   int `json:"stored"`
	Conflict int `json:"conflict"`
	Invalid  int `json:"invalid"`
}

// ChildLinking is the answer to a look at a file: how it was read, the
// columns used and every row.
type ChildLinking struct {
	Encoding  string           `json:"encoding"`
	Delimiter string           `json:"delimiter"`
	Headers   []string         `json:"headers"`
	Columns   ChildLinkColumns `json:"columns"`
	// Unmapped names the fields without a column; the rows are read once
	// each has one.
	Unmapped []string `json:"unmapped"`
	// Fingerprint names the rows and what the run does with each; the run
	// links only the preview it was given.
	Fingerprint string          `json:"fingerprint,omitempty"`
	Applied     bool            `json:"applied"`
	Counts      ChildLinkCounts `json:"counts"`
	Rows        []ChildLinkRow  `json:"rows"`
}

// ChildLinkInput is the link of one contract by hand: the child record and,
// with Apply, the link itself. AcceptDifference links although the name or
// the date of birth of the child record is not the contract's: the office
// saw both and confirmed that they name one child. Fingerprint is the one of
// the row the office saw; Apply requires it and refuses with
// ErrChildLinkChanged when the row differs from it.
type ChildLinkInput struct {
	StudentID        ident.ID `json:"student_id"`
	Apply            bool     `json:"apply"`
	AcceptDifference bool     `json:"accept_difference"`
	Fingerprint      string   `json:"fingerprint"`
}

// SchoolChild is a child record of a school as the link compares it.
type SchoolChild struct {
	StudentID int64
	FirstName string
	LastName  string
	BirthDate *calendar.Date
}

// SchoolChildren reads child records of the school whose tenant transaction
// the caller holds (People Directory): those of ids the school has, in one
// read. An identifier of another school answers nothing.
type SchoolChildren interface {
	SchoolChildren(ctx context.Context, ids []int64) ([]SchoolChild, error)
}

// ContractChildLinks links imported contracts to the child records of their
// schools. It reads each school in that school's tenant transaction and
// writes in the Träger transaction, one after the other, so it opens its own
// units and must be called outside any transaction.
type ContractChildLinks interface {
	// LinkChildren reads a file of contracts and child records and answers
	// every row; with Apply it links the ready rows in one go and records
	// each with the name and the line of the file.
	LinkChildren(ctx context.Context, reviewer Reviewer, request ChildLinkRequest) (ChildLinking, error)
	// LinkChild answers what linking one contract to a child record would
	// do, and with Apply links it. A row that is not ready is
	// ErrChildLinkRefused, with the row that names why; a row that is not
	// the one the office saw (input.Fingerprint) is ErrChildLinkChanged.
	LinkChild(ctx context.Context, reviewer Reviewer, contractID int64, input ChildLinkInput) (ChildLinkRow, error)
	// UnlinkChild takes the child record studentID, the one the office saw,
	// off an imported contract, to correct a wrong link. A contract without
	// one stays as it is; one linked to another child record is
	// ErrChildLinkChanged, one bound to the application of its child
	// ErrChildLinkBound.
	UnlinkChild(ctx context.Context, reviewer Reviewer, contractID, studentID int64) error
}
