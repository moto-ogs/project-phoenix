package carecontract

import (
	"context"
	"errors"
	"time"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

// Correction of what an import could only assume about a contract it took
// over (#7767, ADR 0232). The import stores every contract as concluded on
// paper, with at most one party and, without a day in the file, on its first
// day. Once the Träger-Büro holds the original documents, it completes the
// contract from a file: the parties the documents name, whether the contract
// was concluded online or on paper, and the day it was concluded or that no
// document names one. The preview shows every row with the values before and
// after; nothing is stored before the office confirms it.
//
// Invariants:
//   - A correction changes the contract a row names by its number, and only
//     a contract from an import: moto records the conclusion of its own
//     contracts itself.
//   - It writes the parties' names, the method and the day of the
//     conclusion, nothing else. Versions, booked care, the child, mandates,
//     debtor numbers, mails, signatures and invoices stay untouched.
//   - A party is never removed and never loses its e-mail address or its
//     account: the Elternabrechnung finds the family by them. Its name
//     changes only to one that shares a word with it; a further party is
//     stored by its name only.
//   - A day no document proves is unknown, never a guess: the contract
//     carries the mark and nothing counts from the instant it keeps.
//   - Every correction lands in the trail with the values before and after,
//     the file, its line and the proof the office named.
//   - A repeated file changes nothing: a row whose values the contract has
//     already is left alone.

// Columns of a correction file, by the header the list to download gives
// each.
const (
	ContractCorrectionFieldContract    = "contract_id"
	ContractCorrectionFieldChild       = "child"
	ContractCorrectionFieldParties     = "parties"
	ContractCorrectionFieldMethod      = "method"
	ContractCorrectionFieldConcludedOn = "concluded_on"
	ContractCorrectionFieldEvidence    = "evidence"
)

// What a correction does with a row.
const (
	// ContractCorrectionChange changes the contract.
	ContractCorrectionChange = "change"
	// ContractCorrectionUnchanged names what the contract has already.
	ContractCorrectionUnchanged = "unchanged"
	// ContractCorrectionInvalid names no contract to correct or a value that
	// is none.
	ContractCorrectionInvalid = "invalid"
	// ContractCorrectionCorrected is a row the correction stored.
	ContractCorrectionCorrected = "corrected"
)

// Problems of a row. Each names a column and a code; none repeats a value.
const (
	ContractCorrectionProblemMissing = "missing"
	ContractCorrectionProblemInvalid = "invalid"
	ContractCorrectionProblemTooLong = "too_long"
	ContractCorrectionProblemFuture  = "future"
	// ContractCorrectionProblemUnknown is a number no contract of the Träger
	// carries.
	ContractCorrectionProblemUnknown = "unknown"
	// ContractCorrectionProblemNotImported is a contract moto concluded
	// itself.
	ContractCorrectionProblemNotImported = "not_imported"
	// ContractCorrectionProblemChildDiffers is a row whose child is not the
	// child of the contract its number names.
	ContractCorrectionProblemChildDiffers = "child_differs"
	// ContractCorrectionProblemRepeated is a contract another row of the
	// file names.
	ContractCorrectionProblemRepeated = "repeated"
	// ContractCorrectionProblemPartyRemoved is a row that leaves out a party
	// of the contract.
	ContractCorrectionProblemPartyRemoved = "party_removed"
	// ContractCorrectionProblemPartyUnclear is a row whose names do not tell
	// which of them a party of the contract is: the party keeps its address
	// and its account, so no name is written onto it by its place alone.
	ContractCorrectionProblemPartyUnclear = "party_unclear"
	// ContractCorrectionProblemAfterNotice is a day of the conclusion after
	// the day a termination or withdrawal of the contract was received.
	ContractCorrectionProblemAfterNotice = "after_notice"
)

// MaxContractCorrectionParties bounds the parties of one contract;
// MaxContractCorrectionEvidence the proof the trail keeps per row.
const (
	MaxContractCorrectionParties  = 6
	MaxContractCorrectionEvidence = 500
)

// ErrContractCorrectionChanged reports a correction whose rows no longer are
// what the office confirmed in the preview: a contract changed since. The
// office loads the preview again.
var ErrContractCorrectionChanged = errors.New("the correction differs from the confirmed preview")

// ContractCorrectionRequest is one look at a file: the preview when Apply is
// not set, the correction of its changing rows when it is.
type ContractCorrectionRequest struct {
	Content  []byte
	FileName string
	Apply    bool
	// Fingerprint is the fingerprint of the preview the office confirmed;
	// Apply refuses with ErrContractCorrectionChanged when the rows differ
	// from it.
	Fingerprint string
}

// ContractCorrectionProblem is one problem of a row: the column and the code.
type ContractCorrectionProblem struct {
	Field string `json:"field"`
	Code  string `json:"code"`
}

// ContractCorrectionValues are the values a correction can change, as a
// contract carries them.
type ContractCorrectionValues struct {
	// Parties are the names of the parties in their order.
	Parties []string `json:"parties"`
	// Method is MethodElectronic for a contract concluded online or
	// MethodPaper; empty when the contract is not concluded.
	Method string `json:"method"`
	// ConcludedOn is the day of the conclusion; nil when DateUnknown or
	// when the contract is not concluded.
	ConcludedOn *calendar.Date `json:"concluded_on"`
	DateUnknown bool           `json:"date_unknown"`
}

// ContractCorrectionRow is a row of the file as the correction reads it.
type ContractCorrectionRow struct {
	Line       int      `json:"line"`
	Status     string   `json:"status"`
	ContractID ident.ID `json:"contract_id,omitempty"`
	ChildName  string   `json:"child_name"`
	SchoolName string   `json:"school_name"`
	// Changes names the columns whose value the row changes.
	Changes []string `json:"changes"`
	// Before are the values of the contract, After what it carries once the
	// row is stored; both empty for a row that names no contract.
	Before   ContractCorrectionValues    `json:"before"`
	After    ContractCorrectionValues    `json:"after"`
	Evidence string                      `json:"evidence"`
	Problems []ContractCorrectionProblem `json:"problems"`
	// RepeatsLine is the line of the row that names the same contract before
	// this one (ContractCorrectionProblemRepeated).
	RepeatsLine int `json:"repeats_line,omitempty"`
}

// ContractCorrectionCounts counts the rows per status.
type ContractCorrectionCounts struct {
	Change    int `json:"change"`
	Unchanged int `json:"unchanged"`
	Invalid   int `json:"invalid"`
	Corrected int `json:"corrected"`
}

// ContractCorrectionRun is the answer to a look at a file.
type ContractCorrectionRun struct {
	Encoding  string   `json:"encoding"`
	Delimiter string   `json:"delimiter"`
	Headers   []string `json:"headers"`
	// Missing names the required columns the file lacks; its rows are read
	// once it has them.
	Missing []string `json:"missing"`
	// Fingerprint names the rows and what the correction does with each; the
	// correction stores only the preview it was given.
	Fingerprint string                   `json:"fingerprint,omitempty"`
	Applied     bool                     `json:"applied"`
	Counts      ContractCorrectionCounts `json:"counts"`
	Rows        []ContractCorrectionRow  `json:"rows"`
}

// ContractCorrectionSheet is the list the office downloads, fills in and
// loads up again: one line per contract from an import with the values a
// correction can change, under the headers a correction file reads.
type ContractCorrectionSheet struct {
	Headers []string
	Rows    [][]string
}

// ContractCorrectionEntry is one correction file in the log: when, by whom,
// which file and how many contracts it changed.
type ContractCorrectionEntry struct {
	File        string    `json:"file"`
	AccountID   *ident.ID `json:"account_id"`
	CorrectedAt time.Time `json:"corrected_at"`
	Contracts   int       `json:"contracts"`
}

// ContractCorrection is one stored correction of a contract, as its page
// shows it: when, the proof and the values before and after.
type ContractCorrection struct {
	CorrectedAt time.Time                `json:"corrected_at"`
	File        string                   `json:"file"`
	Evidence    string                   `json:"evidence"`
	Changes     []string                 `json:"changes"`
	Before      ContractCorrectionValues `json:"before"`
	After       ContractCorrectionValues `json:"after"`
}

// ContractCorrections completes the contracts an import took over. It works
// in the Träger transaction and records in the access log of every school
// whose contracts it showed or changed, so it opens its own units and must
// be called outside any transaction.
type ContractCorrections interface {
	// CorrectContracts reads a file and answers every row; with Apply it
	// stores the changing rows in one go and records each in the trail.
	CorrectContracts(ctx context.Context, reviewer Reviewer, request ContractCorrectionRequest) (ContractCorrectionRun, error)
	// ContractCorrectionList lists every contract from an import with the
	// values a correction can change, by school and child.
	ContractCorrectionList(ctx context.Context, reviewer Reviewer) (ContractCorrectionSheet, error)
	// ContractCorrectionLog lists the correction files of the Träger, newest
	// first.
	ContractCorrectionLog(ctx context.Context, reviewer Reviewer) ([]ContractCorrectionEntry, error)
}
