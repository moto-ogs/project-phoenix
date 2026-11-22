package ports

import (
	"time"

	"github.com/moto-ogs/project-phoenix/modules/carecontract"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// ContractChild is the child of a contract of the Träger, as its newest
// version names it, with the last day the contract holds: the earlier of the
// end of a termination and the end of that version, as the billing reads it
// (VersionsInForce), nil when neither ends. ImportOrigin is the origin of a
// contract an import stored, empty for one from an application. StartsOn is
// the first day of its first version and StudentID the child record of the
// school it is linked to, nil without one (#7760). RequestChildID is the
// application child of a contract from an application, nil for an imported
// one: with it the read also gives the keys of the contracts.
type ContractChild struct {
	ContractID   int64
	SchoolID     int64
	Status       string
	FirstName    string
	LastName     string
	BirthDate    *calendar.Date
	StartsOn     calendar.Date
	EndsOn       *calendar.Date
	ImportOrigin string
	StudentID    *int64
	// RequestChildID is the key of a contract from an application.
	RequestChildID *int64
}

// ChildLink names the child record an imported contract is linked to
// (#7760).
type ChildLink struct {
	ContractID int64
	StudentID  int64
}

// The keys of a trail entry that names the file and the line a link came
// from. They differ from ImportActionDetail, so the log of the imports
// counts no link as an imported contract.
const (
	LinkFileDetail = "link_file"
	LinkLineDetail = "link_line"
)

// ImportedContract is a contract an import file names (#4723): its school,
// its key, the instant of its conclusion, its first version and its party.
// A file that names no day of the conclusion leaves it unknown (#7767):
// ConcludedAt then is the first day of the contract, which the store needs
// for an active contract, and ConclusionDateUnknown says that it is no date.
type ImportedContract struct {
	Line                  int
	SchoolID              int64
	ImportKey             string
	ConcludedAt           time.Time
	ConclusionDateUnknown bool
	Version               carecontract.Version
	Party                 NewParty
}

// ImportActionDetail is the key of a trail entry that names the file an
// imported contract came from.
const ImportActionDetail = "import_file"

// CorrectableContract is a contract a correction file names (#7764): its
// school, its status, the last day of a termination, its effective versions
// by effective date and the number its next version gets. FollowsBookings
// tells that the contract has an application child: its versions follow the
// bookings of that child (AmendFromBookings), also when an import stored the
// contract and a later step bound it to an application (#7760).
type CorrectableContract struct {
	ID              int64
	SchoolID        int64
	Status          string
	FollowsBookings bool
	EndsOn          *calendar.Date
	NextNumber      int
	Versions        []carecontract.Version
}

// CorrectedVersion is the new version a correction gives a contract, with
// its step on the timeline.
type CorrectedVersion struct {
	ContractID int64
	Step       VersionStep
	Version    carecontract.Version
}

// OfferingCorrectionActionDetail is the key of a trail entry that names the
// file a correction of the booked modules came from.
const OfferingCorrectionActionDetail = "offering_correction_file"
