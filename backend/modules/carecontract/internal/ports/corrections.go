package ports

import (
	"time"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// CorrectionParty is a party of a contract as a correction reads it (#7767).
type CorrectionParty struct {
	ID        int64  `json:"id"`
	FirstName string `json:"first_name"`
	LastName  string `json:"last_name"`
}

// CorrectionSubject is a contract a correction file names, with what a
// correction can change: whether an import stored it, its conclusion, its
// parties in their order and the day its first termination or withdrawal was
// received. The child is the one its newest version names.
type CorrectionSubject struct {
	ContractID     int64
	SchoolID       int64
	SchoolName     string
	ChildFirstName string
	ChildLastName  string
	Imported       bool
	ConcludedAt    *time.Time
	Method         string
	DateUnknown    bool
	Parties        []CorrectionParty
	FirstNoticeOn  *calendar.Date
}

// Correction is what a correction stores for one contract: its conclusion,
// when Conclusion is set, the parties whose name changes and the parties it
// adds, in their order.
type Correction struct {
	ContractID  int64
	Conclusion  bool
	ConcludedAt time.Time
	Method      string
	DateUnknown bool
	Renames     []CorrectionParty
	Adds        []CorrectionParty
}

// The details of a trail entry of a correction.
const (
	// CorrectionFileDetail names the file a correction came from.
	CorrectionFileDetail     = "correction_file"
	CorrectionLineDetail     = "correction_line"
	CorrectionEvidenceDetail = "evidence"
	CorrectionChangesDetail  = "changes"
	CorrectionBeforeDetail   = "before"
	CorrectionAfterDetail    = "after"
)
