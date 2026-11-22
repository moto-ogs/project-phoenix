package ports

import (
	"time"

	"github.com/moto-ogs/project-phoenix/modules/carecontract"
	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// ContractChild is the child of a contract of the Träger, as its newest
// version names it, with the last day the contract holds: the end of a
// termination, else the end of that version. ImportOrigin is the origin of a
// contract an import stored, empty for one from an application.
type ContractChild struct {
	ContractID   int64
	SchoolID     int64
	Status       string
	FirstName    string
	LastName     string
	BirthDate    *calendar.Date
	EndsOn       *calendar.Date
	ImportOrigin string
}

// ImportedContract is a contract an import file names (#4723): its school,
// its key, the instant of its conclusion, its first version and its party.
type ImportedContract struct {
	Line        int
	SchoolID    int64
	ImportKey   string
	ConcludedAt time.Time
	Version     carecontract.Version
	Party       NewParty
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
