package carecontract

import (
	"context"
	"time"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// The contracts of an application as the school reads them (#4788, ADR 0088
// section 7): the enrollment detail shows, per child of the application, the
// contract the Träger made from it. The key of a contract is the child of the
// application (ADR 0153 point 2), so the school asks by request child.

// MaxApplicationChildren bounds one read: an application names a handful of
// children, never this many.
const MaxApplicationChildren = 50

// ApplicationContract is the contract of one child of an application at the
// reading school: its status and, from the newest version that was not
// rejected, from when which modules are booked on which weekday.
type ApplicationContract struct {
	RequestChildID int64
	ContractID     int64
	Status         string
	SentAt         *time.Time
	// Concluded is how and when the contract was concluded; nil before.
	Concluded *Concluded
	// EndsOn is the last day of a terminated contract; nil otherwise.
	EndsOn *calendar.Date
	// EffectiveFrom is the first day of the newest version.
	EffectiveFrom *calendar.Date
	Services      []Service
}

// ApplicationContracts reads the contracts of the given application children
// at the school whose tenant transaction the caller holds. Drafts stay out:
// the school's policy does not show them, and they promise nothing yet. A
// child without a contract is missing from the result.
type ApplicationContracts interface {
	ApplicationContracts(ctx context.Context, requestChildIDs []int64) ([]ApplicationContract, error)
}
