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
