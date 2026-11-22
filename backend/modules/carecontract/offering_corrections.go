package carecontract

import (
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
	"github.com/moto-ogs/project-phoenix/sharedkernel/ident"
)

// Correction of the modules imported contracts book (#7764, ADR 0306). An
// import names the modules of a contract by the names of the file; when the
// Träger tidies its modules afterwards (one module per kind of care instead
// of one per weekly pattern, separate modules where the prices differ), the
// contracts still book the old ones. The office names, per contract, weekday
// and booked module, the module it belongs to, and moto shows what it would
// change before anything is stored.
//
// Invariants (each has a test):
//   - A correction is a new version of the contract from the chosen day, with
//     the source angebotskorrektur. Earlier versions stay as they were: what
//     a month was billed with remains readable.
//   - Only the module of a booking changes. Its weekday, its end time and its
//     last booked day stay.
//   - The day is today or later, and never before the contract begins: a
//     contract that begins later is corrected from its first day.
//   - Only a contract without an application child is corrected: one an
//     import stored and no later step bound to an application (#7760). A
//     contract with an application child follows the bookings of its
//     school; the next run of AmendFromBookings would undo the correction.
//     Its modules change with the bookings, as every approved change does.
//   - A contract is corrected as a whole or not at all: one row with a
//     problem, or one row without a target, leaves all its bookings as they
//     are and names the contract.
//   - A repeated run changes nothing: a booking that names its target
//     already makes no new version.
//   - Nothing is sent to the parents and no billing run starts.

// Fields of a row of the correction file.
const (
	OfferingCorrectionFieldContract = "contract"
	OfferingCorrectionFieldWeekday  = "weekday"
	OfferingCorrectionFieldCurrent  = "current_offering"
	OfferingCorrectionFieldTarget   = "target_offering"
)

// What the correction does with a contract.
const (
	// OfferingCorrectionReady gets a new version.
	OfferingCorrectionReady = "ready"
	// OfferingCorrectionUnchanged books the targets already.
	OfferingCorrectionUnchanged = "unchanged"
	// OfferingCorrectionHeld has a row without a target: the office has not
	// decided it yet, so the contract stays as it is and is named.
	OfferingCorrectionHeld = "held"
	// OfferingCorrectionInvalid has a row with a problem.
	OfferingCorrectionInvalid = "invalid"
	// OfferingCorrectionCorrected is a contract the run gave a new version.
	OfferingCorrectionCorrected = "corrected"
)

// Problems of a row. Each names a line, a field and a code.
const (
	OfferingCorrectionProblemMissing = "missing"
	OfferingCorrectionProblemInvalid = "invalid"
	// OfferingCorrectionProblemUnknown is a contract the Träger does not
	// have, or a module the school of the contract does not have.
	OfferingCorrectionProblemUnknown   = "unknown"
	OfferingCorrectionProblemAmbiguous = "ambiguous"
	// OfferingCorrectionProblemFollowsBookings is a contract with an
	// application child: its modules follow the bookings of the school.
	OfferingCorrectionProblemFollowsBookings = "follows_bookings"
	// OfferingCorrectionProblemNotActive is a contract that does not run: it
	// is neither aktiv nor gekuendigt. A terminated contract is corrected
	// until its last day.
	OfferingCorrectionProblemNotActive = "not_active"
	// OfferingCorrectionProblemEnded is a contract that ends before the day.
	OfferingCorrectionProblemEnded = "ended"
	// OfferingCorrectionProblemLaterVersion is a contract with a version that
	// starts after the day: the correction would not reach it.
	OfferingCorrectionProblemLaterVersion = "later_version"
	// OfferingCorrectionProblemNotBooked is a module the contract does not
	// book on that weekday.
	OfferingCorrectionProblemNotBooked = "not_booked"
	// OfferingCorrectionProblemRepeated is a booking another row names too.
	OfferingCorrectionProblemRepeated = "repeated"
	// OfferingCorrectionProblemOverlapping is a module that is, on one
	// weekday, the current module of one row and the target of another: the
	// rows would move a booking twice or swap two bookings.
	OfferingCorrectionProblemOverlapping = "overlapping"
	// OfferingCorrectionProblemInactive is a target the Träger has switched
	// off; OfferingCorrectionProblemOutsidePhase one whose phase does not run
	// on the day or ends before the booking does.
	OfferingCorrectionProblemInactive     = "inactive"
	OfferingCorrectionProblemOutsidePhase = "outside_phase"
	// OfferingCorrectionProblemNotOffered is a weekday the target does not
	// run on.
	OfferingCorrectionProblemNotOffered = "not_offered"
	// OfferingCorrectionProblemDoubleBooked is a target the contract would
	// book twice on one weekday.
	OfferingCorrectionProblemDoubleBooked = "double_booked"
)

// Hints of a contract; none holds it back.
const (
	// OfferingCorrectionHintStartMoved is a contract that begins after the
	// chosen day: its correction holds from its first day.
	OfferingCorrectionHintStartMoved = "start_moved"
	// OfferingCorrectionHintEndTimeDiffers is a booking whose end time is
	// another than the target's on that weekday: the contract keeps its own.
	OfferingCorrectionHintEndTimeDiffers = "end_time_differs"
)

// OfferingCorrectionColumns are the columns a correction file needs, by the
// header moto reads each from.
var OfferingCorrectionColumns = []string{
	OfferingCorrectionFieldContract, OfferingCorrectionFieldWeekday,
	OfferingCorrectionFieldCurrent, OfferingCorrectionFieldTarget,
}

// OfferingCorrectionRequest is one look at a correction file: the preview
// when Apply is not set, the correction of its ready contracts when it is.
type OfferingCorrectionRequest struct {
	Content   []byte
	FileName  string
	Delimiter string
	// EffectiveFrom is the day the corrections hold from: today or later.
	EffectiveFrom calendar.Date
	Apply         bool
	// Fingerprint is the fingerprint of the preview the office confirmed;
	// Apply refuses with ErrContractImportChanged when the contracts differ
	// from it.
	Fingerprint string
}

// OfferingCorrectionProblem is one problem of a row.
type OfferingCorrectionProblem struct {
	Line  int    `json:"line"`
	Field string `json:"field"`
	Code  string `json:"code"`
}

// OfferingCorrectionChange is one module of a contract and the module its
// bookings go to, with the weekdays concerned. To is empty for a row the
// office has not decided yet.
type OfferingCorrectionChange struct {
	Weekdays []string `json:"weekdays"`
	From     string   `json:"from"`
	To       string   `json:"to"`
}

// OfferingCorrectionContract is a contract the file names, with what the
// correction does with it.
type OfferingCorrectionContract struct {
	// Reference is the contract as the file names it.
	Reference      string   `json:"reference"`
	Line           int      `json:"line"`
	ContractID     ident.ID `json:"contract_id,omitempty"`
	SchoolID       ident.ID `json:"school_id,omitempty"`
	SchoolName     string   `json:"school_name"`
	ChildFirstName string   `json:"child_first_name"`
	ChildLastName  string   `json:"child_last_name"`
	Status         string   `json:"status"`
	// EffectiveFrom is the first day of the new version; nil without one.
	EffectiveFrom *calendar.Date `json:"effective_from"`
	// VersionNumber is the number of the new version; 0 without one.
	VersionNumber int                         `json:"version_number,omitempty"`
	Changes       []OfferingCorrectionChange  `json:"changes"`
	Problems      []OfferingCorrectionProblem `json:"problems"`
	Hints         []string                    `json:"hints"`
}

// OfferingCorrectionCounts counts the contracts per status.
type OfferingCorrectionCounts struct {
	Ready     int `json:"ready"`
	Unchanged int `json:"unchanged"`
	Held      int `json:"held"`
	Invalid   int `json:"invalid"`
	Corrected int `json:"corrected"`
}

// OfferingCorrection is the answer to a look at a correction file.
type OfferingCorrection struct {
	Encoding  string   `json:"encoding"`
	Delimiter string   `json:"delimiter"`
	Headers   []string `json:"headers"`
	// MissingColumns names the fields no header of the file gives; the
	// contracts are read once each has one.
	MissingColumns []string      `json:"missing_columns"`
	EffectiveFrom  calendar.Date `json:"effective_from"`
	// Fingerprint names the contracts and what the correction does with
	// each; the correction takes over only the preview it was given.
	Fingerprint string                       `json:"fingerprint,omitempty"`
	Applied     bool                         `json:"applied"`
	Counts      OfferingCorrectionCounts     `json:"counts"`
	Contracts   []OfferingCorrectionContract `json:"contracts"`
}
