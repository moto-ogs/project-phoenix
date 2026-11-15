package workforce

import (
	"context"
	"errors"

	"github.com/moto-ogs/project-phoenix/sharedkernel/calendar"
)

// The Vertretungspool of the Träger (#4709, ADR 0089 section 9, ADR 0248):
// an Arbeitsvertrag with the Merkmal „Vertretungspool“ makes its person a
// Springer every school of the Träger may block for a day and a time. Two
// live blocks of one Springer never overlap, also when two schools block at
// the same moment: the database keeps them apart and the second school gets
// ErrPoolBlockTaken. A school sees of a Springer only the name, the status
// of the Nachweise and the blocked times, and of another school's block only
// which school holds it. The Personalverwaltung sees every block and may lift
// one.

// TraegerStaffViewPool is the access log view of the pool in the
// Träger-Portal.
const TraegerStaffViewPool = "staff_pool"

// TraegerStaffViewPoolLift is the access log view of the Personalverwaltung
// lifting a block of the school.
const TraegerStaffViewPoolLift = "staff_pool_lift"

// StaffDataAccessPool is the access log resource of a school reading the
// Springer of its Träger.
const StaffDataAccessPool = "traeger_staff_pool"

var (
	// ErrPoolSpringerNotFound answers a person who is no Springer of the
	// school's Träger on the requested day, or a school whose Träger has no
	// release „Personal beim Träger“.
	ErrPoolSpringerNotFound = errors.New("workforce: no Springer of the Träger on this day")
	// ErrPoolBlockTaken refuses a block that overlaps a live block of the
	// same Springer, by this or another school.
	ErrPoolBlockTaken = errors.New("workforce: the Springer is already blocked at this time")
	// ErrPoolSpringerBusy refuses a block at a time the Springer works a
	// shift at one of its Einsatzorte.
	ErrPoolSpringerBusy = errors.New("workforce: the Springer works a shift at this time")
	// ErrPoolBlockNotFound answers a block that is not a live block of the
	// school or, in the Träger-Portal, of the Träger.
	ErrPoolBlockNotFound = errors.New("workforce: pool block not found")
	// ErrPoolBlockInvalid refuses a block in the past, on a weekend, or
	// with an end before its start; the week view shows Monday to Friday.
	ErrPoolBlockInvalid = errors.New("workforce: the pool block is invalid")
)

// PoolProofStatus is the status of one kind of Nachweis of a Springer:
// "complete", "missing" or "expiring" with the expiry date, nothing of the
// proof itself (ADR 0089 section 7).
type PoolProofStatus struct {
	TypeName  string         `json:"type_name"`
	Status    string         `json:"status"`
	ExpiresOn *calendar.Date `json:"expires_on,omitempty"`
}

// The status values of PoolProofStatus.
const (
	PoolProofComplete = "complete"
	PoolProofMissing  = "missing"
	PoolProofExpiring = "expiring"
)

// PoolBlock is one block of a Springer. ID is set only for a block of the
// reading school (and always in the Träger-Portal); another school's block
// names only that school. Lifted marks a block of the reading school the
// Personalverwaltung lifted.
type PoolBlock struct {
	ID         *int64        `json:"id,omitempty"`
	SchoolID   int64         `json:"school_id"`
	SchoolName string        `json:"school_name"`
	Own        bool          `json:"own"`
	Date       calendar.Date `json:"date"`
	StartTime  string        `json:"start_time"`
	EndTime    string        `json:"end_time"`
	Lifted     bool          `json:"lifted"`
}

// PoolSpringer is one Springer in a week: the days its pool contract
// covers, the status of its Nachweise and its blocks of the week.
type PoolSpringer struct {
	RecordID  int64             `json:"staff_record_id"`
	FirstName string            `json:"first_name"`
	LastName  string            `json:"last_name"`
	PoolFrom  calendar.Date     `json:"pool_from"`
	PoolUntil *calendar.Date    `json:"pool_until"`
	Proofs    []PoolProofStatus `json:"proofs"`
	Blocks    []PoolBlock       `json:"blocks"`
}

// PoolWeek is the pool of the Träger from Monday WeekStart to Sunday.
// Available is false for a school whose Träger keeps no staff in moto; the
// list is then empty.
type PoolWeek struct {
	WeekStart calendar.Date  `json:"week_start"`
	Today     calendar.Date  `json:"today"`
	Available bool           `json:"available"`
	Springers []PoolSpringer `json:"springers"`
}

// PoolBlockInput blocks a Springer on Date from StartTime to EndTime
// (HH:MM wall clock).
type PoolBlockInput struct {
	RecordID  int64
	Date      calendar.Date
	StartTime string
	EndTime   string
}

// SchoolPoolActor is the staff member of the school who reads or blocks.
type SchoolPoolActor struct {
	AccountID int64
	Role      string
}

// SchoolStaffPool is the Vertretungspool as a school sees it. It joins the
// tenant transaction of the request; every read writes its access entry
// into the school's access log first.
type SchoolStaffPool interface {
	SchoolPoolWeek(ctx context.Context, actor SchoolPoolActor, weekStart calendar.Date) (PoolWeek, error)
	BlockSpringer(ctx context.Context, actor SchoolPoolActor, input PoolBlockInput) (PoolBlock, error)
	LiftSchoolBlock(ctx context.Context, actor SchoolPoolActor, blockID int64) error
}

// TraegerStaffPool is the Vertretungspool in the Träger-Portal: every
// Springer with every block of the week, and lifting a block. Reading
// writes an access entry at each school a listed Springer works at or was
// blocked by (ADR 0089 section 6).
type TraegerStaffPool interface {
	TraegerPoolWeek(ctx context.Context, actor TraegerStaffActor, weekStart calendar.Date) (PoolWeek, error)
	LiftTraegerBlock(ctx context.Context, actor TraegerStaffActor, blockID int64) error
}
