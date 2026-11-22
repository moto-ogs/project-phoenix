package parentbilling

import (
	"context"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

// The children of the families from a file (#7356). A Träger that counts
// siblings by the children of the family keeps that number in another
// program, for example OGS Connect ("Anzahl der Kinder in der Familie unter
// 18 Jahren"), and its contracts came into moto without it. The office adds
// the numbers from a CSV file: each row names a child with a contract by
// name, date of birth and school, and the number of its family. The preview
// shows every row with what moto would do before anything is stored.
//
// Invariants:
//   - The number of a row goes to the family of the child's contract: the
//     mail address of its invoice's recipient, else the contract itself
//     (ContractFamilyKey).
//   - The number counts as confirmed by the Abrechnung, which imports it,
//     from the first day of the family's contract, without an end. The
//     import reads the contracts of the page of the numbers, in force from
//     three months back; a contract that began earlier counts from the
//     first day of that window.
//   - A number the Abrechnung confirmed before is never overwritten: a row
//     that names another one is shown and left to the office.
//   - Rows of one family that name different numbers take over none.
//   - A row that names no single child with a contract takes over nothing:
//     a name and a date of birth find a contract of the Träger, they prove
//     no identity beyond it.
//   - Only the number is stored. The file itself is never stored; every
//     number taken over stands in the trail of its contract.
//   - The import takes over only the preview the office confirmed, by its
//     fingerprint; else ErrImportChanged.

// Fields a column of the file can be mapped to.
const (
	FamilyImportFieldChildFirstName = "child_first_name"
	FamilyImportFieldChildLastName  = "child_last_name"
	FamilyImportFieldChildBirthDate = "child_birth_date"
	FamilyImportFieldSchool         = "school"
	FamilyImportFieldChildren       = "children"
)

// What the import does with a row.
const (
	// FamilyImportReady is taken over as it is.
	FamilyImportReady = "ready"
	// FamilyImportSame names the number the family already has confirmed.
	FamilyImportSame = "same"
	// FamilyImportDiffers names another number than the Abrechnung
	// confirmed: the import never overwrites it.
	FamilyImportDiffers = "differs"
	// FamilyImportConflict contradicts another row or stored confirmations.
	FamilyImportConflict = "conflict"
	// FamilyImportInvalid misses a field, carries no number or names no
	// single child with a contract.
	FamilyImportInvalid = "invalid"
	// FamilyImportImported is a row the import stored.
	FamilyImportImported = "imported"
)

// Problems of a row. Each names a field and a code; none repeats a value.
const (
	FamilyImportProblemMissing = "missing"
	FamilyImportProblemInvalid = "invalid"
	FamilyImportProblemTooLong = "too_long"
	// FamilyImportProblemUnknown is a school the Träger does not have under
	// that name; FamilyImportProblemAmbiguous a name several schools carry,
	// or a child the row cannot tell from another with the same name.
	FamilyImportProblemUnknown   = "unknown"
	FamilyImportProblemAmbiguous = "ambiguous"
	// FamilyImportProblemNoContract is a child without a contract at the
	// school in the window of the page.
	FamilyImportProblemNoContract = "no_contract"
	// FamilyImportProblemRepeated is a child another row names before;
	// FamilyImportProblemRowsDiffer are rows of one family with different
	// numbers.
	FamilyImportProblemRepeated   = "repeated"
	FamilyImportProblemRowsDiffer = "rows_differ"
	// FamilyImportProblemConfirmationsDiffer requires an office decision
	// between conflicting stored confirmations, not a correction of the file.
	FamilyImportProblemConfirmationsDiffer = "confirmations_differ"
)

// FamilyChildrenImportColumns names per field the header of the column it
// comes from; empty leaves the field unmapped.
type FamilyChildrenImportColumns struct {
	ChildFirstName string `json:"child_first_name"`
	ChildLastName  string `json:"child_last_name"`
	ChildBirthDate string `json:"child_birth_date"`
	School         string `json:"school"`
	Children       string `json:"children"`
}

// FamilyChildrenImportMapping is how the rows of a file name a child and
// its family's number. A file of one school needs no column for it:
// SchoolID names the school of every row.
type FamilyChildrenImportMapping struct {
	Columns  FamilyChildrenImportColumns `json:"columns"`
	SchoolID ident.ID                    `json:"school_id"`
}

// FamilyChildrenImportRequest is one look at a file: the preview when Apply
// is not set, the import of its ready rows when it is. Mapping nil takes the
// mapping moto suggests from the headers. Delimiter is ";", "," or "\t",
// empty detects it.
type FamilyChildrenImportRequest struct {
	Content     []byte
	Delimiter   string
	Mapping     *FamilyChildrenImportMapping
	Apply       bool
	Fingerprint string
}

// FamilyChildrenImportProblem is one problem of a row: the field and the
// code.
type FamilyChildrenImportProblem struct {
	Field string `json:"field"`
	Code  string `json:"code"`
}

// FamilyChildrenImportRow is a row of the file as the import reads it.
type FamilyChildrenImportRow struct {
	Line           int            `json:"line"`
	Status         string         `json:"status"`
	ChildFirstName string         `json:"child_first_name"`
	ChildLastName  string         `json:"child_last_name"`
	ChildBirthDate *calendar.Date `json:"child_birth_date"`
	SchoolName     string         `json:"school_name"`
	// Children is the number the row names; nil for none.
	Children *int `json:"children"`
	// ContractID is the contract of the child the number goes to and
	// ValidFrom its first day, from which the number counts.
	ContractID ident.ID       `json:"contract_id,omitempty"`
	ValidFrom  *calendar.Date `json:"valid_from"`
	// ConfirmedChildren is the number the Abrechnung confirmed before, for
	// FamilyImportSame and FamilyImportDiffers.
	ConfirmedChildren *int                          `json:"confirmed_children"`
	Problems          []FamilyChildrenImportProblem `json:"problems"`
	// RepeatsLine is the line of the row that names the same child before
	// this one (FamilyImportProblemRepeated).
	RepeatsLine int `json:"repeats_line,omitempty"`
}

// FamilyChildrenImportCounts counts the rows per status.
type FamilyChildrenImportCounts struct {
	Ready    int `json:"ready"`
	Same     int `json:"same"`
	Differs  int `json:"differs"`
	Conflict int `json:"conflict"`
	Invalid  int `json:"invalid"`
	Imported int `json:"imported"`
}

// FamilyChildrenImport is the answer to a look at a file: how it was read,
// the mapping used and every row.
type FamilyChildrenImport struct {
	Encoding  string                      `json:"encoding"`
	Delimiter string                      `json:"delimiter"`
	Headers   []string                    `json:"headers"`
	Mapping   FamilyChildrenImportMapping `json:"mapping"`
	// Unmapped names the required fields without a column or a choice; the
	// rows are read once each has one.
	Unmapped []string `json:"unmapped"`
	// Schools are the schools of the Träger, for a file without that column.
	Schools []CareSchool `json:"schools"`
	// Fingerprint names the rows and what the import does with each.
	Fingerprint string                     `json:"fingerprint,omitempty"`
	Applied     bool                       `json:"applied"`
	Counts      FamilyChildrenImportCounts `json:"counts"`
	Rows        []FamilyChildrenImportRow  `json:"rows"`
}

// FamilyChildrenImports adds the numbers of the families from a file. It
// names the person of the session and runs in the Träger transaction of its
// Träger, which the caller opens.
type FamilyChildrenImports interface {
	ImportFamilyChildren(ctx context.Context, reviewer HolidayReviewer, request FamilyChildrenImportRequest) (FamilyChildrenImport, error)
}

// ImportedFamilyChildren is the number a file names for the family of a
// contract (#7356): from a row of the numbers' own file, or from the column
// of an import of existing contracts. FamilyEmail is the mail address of
// the contract's party, empty without one; ContractID the contract, 0 while
// an import of contracts only looks. The number counts from ValidFrom on.
type ImportedFamilyChildren struct {
	Line        int
	FamilyEmail string
	ContractID  int64
	Children    int
	ValidFrom   calendar.Date
	// Witness contributes only to detecting contradictory file rows.
	Witness bool
}

// What an import of contracts does with the number of a row.
const (
	// ImportedChildrenNew is taken over as confirmed.
	ImportedChildrenNew = "new"
	// ImportedChildrenSame is the number the family has confirmed.
	ImportedChildrenSame = "same"
	// ImportedChildrenDiffers is another number than the confirmed one: the
	// import never overwrites it.
	ImportedChildrenDiffers = "differs"
	// ImportedChildrenRowsDiffer are rows of one family with different
	// numbers: the import takes over none of them.
	ImportedChildrenRowsDiffer = "rows_differ"
	// ImportedChildrenConfirmationsDiffer cannot be resolved by a file:
	// the family carries conflicting confirmations that the office must settle.
	ImportedChildrenConfirmationsDiffer = "confirmations_differ"
	// ImportedChildrenInvalid is no whole number from 1 to MaxFamilyChildren.
	ImportedChildrenInvalid = "invalid"
)

// ImportedFamilyChildrenDecision is what happens with the number of a row.
type ImportedFamilyChildrenDecision struct {
	Line   int
	Status string
}

// ContractImportFamilyChildren decides and keeps the numbers of the families
// an import of care contracts names (#7356), in the Träger transaction the
// caller holds. A number taken over counts as confirmed by the account that
// imports it.
type ContractImportFamilyChildren interface {
	// DecideImportedFamilyChildren answers per row what the import does with
	// its number, as the numbers stand before the call, and with save takes
	// the new ones over for the contracts just stored and records each.
	// It holds the billing lock until the caller's transaction ends, also
	// without save, so fingerprint validation and storage share one state.
	DecideImportedFamilyChildren(ctx context.Context, reviewer HolidayReviewer, numbers []ImportedFamilyChildren, save bool) ([]ImportedFamilyChildrenDecision, error)
}
